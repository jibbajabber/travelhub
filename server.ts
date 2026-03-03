import express from "express";
import cors from "cors";
import axios from "axios";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// --- Rail Scraping Fallback ---
async function scrapeRailDepartures(crs: string, destination?: string) {
  try {
    const stationCode = (crs || 'SNF').toUpperCase().substring(0, 3);
    let url = `https://www.nationalrail.co.uk/live-trains/departures/${stationCode}/`;

    // If a destination is provided, use the point-to-point URL for better accuracy.
    // National Rail generally works with lowercased hyphenated station names if CRS isn't provided here
    if (destination) {
      let destSlug = destination.toLowerCase().replace(/\s+/g, '-').replace(/\(|\)/g, '');
      url += `${destSlug}/`;
    }

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.5',
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const nextDataScript = $('#__NEXT_DATA__').html();

    if (!nextDataScript) {
      console.warn(`Could not find __NEXT_DATA__ script tag on National Rail page for ${url}`);
      return [];
    }

    const nextData = JSON.parse(nextDataScript);
    const services = nextData.props?.pageProps?.liveTrainsState?.queries?.[0]?.state?.data?.pages?.[0]?.services || [];

    // Create a helper to fetch calling points via GraphQL
    const fetchCallingPoints = async (rid: string, fromCrs: string, toCrs: string) => {
      try {
        const gqlResponse = await axios.post('https://nreservices.nationalrail.co.uk/live-info', {
          operationName: "ServiceDetails",
          variables: {
            rid: rid,
            fromCrs: fromCrs,
            toCrs: toCrs,
            direction: "DEPARTURE"
          },
          query: `query ServiceDetails($rid: ID!, $fromCrs: String, $toCrs: String, $direction: NreDirectionType!) {
            ServiceDetails(rid: $rid, fromCrs: $fromCrs, toCrs: $toCrs, direction: $direction) {
              callingPoints {
                stationInfo {
                  locationName
                  crs
                }
              }
            }
          }`
        }, {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Origin': 'https://www.nationalrail.co.uk',
            'Referer': 'https://www.nationalrail.co.uk/',
          },
          timeout: 5000
        });

        const allStops = gqlResponse.data?.data?.ServiceDetails?.callingPoints || [];

        // Find the index of the current station (fromCrs) to only show subsequent stops
        const fromIndex = allStops.findIndex((cp: any) => cp.stationInfo.crs === fromCrs);
        const subsequentStops = fromIndex !== -1 ? allStops.slice(fromIndex + 1) : allStops;

        return subsequentStops.map((cp: any) => cp.stationInfo.locationName);
      } catch (e) {
        console.error("Calling points fetch failed:", e instanceof Error ? e.message : e);
        return [];
      }
    };

    const departurePromises = services.map(async (s: any) => {
      const depInfo = s.departureInfo || {};
      const arrivalAtDest = s.journeyDetails?.arrivalInfo || {};
      const departureTime = depInfo.scheduled ? new Date(depInfo.scheduled).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : "N/A";

      // Calculate duration in minutes
      let duration = 0;
      if (depInfo.scheduled && arrivalAtDest.scheduled) {
        const start = new Date(depInfo.scheduled).getTime();
        const end = new Date(arrivalAtDest.scheduled).getTime();
        duration = Math.round((end - start) / (1000 * 60));
      }

      // Normalize status
      let statusSlug = s.status?.status || "Unknown";
      let status = "Unknown";
      if (statusSlug === "OnTime") status = "On time";
      else if (statusSlug === "Cancelled") status = "Cancelled";
      else if (statusSlug === "Delayed") status = "Delayed";
      else if (s.status?.delay) status = s.status.delay;
      else status = statusSlug;

      // Calculate ETA (planned arrival time at destination)
      const eta = arrivalAtDest.scheduled ? new Date(arrivalAtDest.scheduled).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : "N/A";

      // Fetch actual calling points if we have an RID and destination
      let stops: string[] = [];
      if (s.rid && s.destination?.[0]?.crs) {
        stops = await fetchCallingPoints(s.rid, stationCode, s.destination[0].crs);
      }

      // Fallback to stop count if GraphQL fails or no data
      if (stops.length === 0 && s.journeyDetails?.stops) {
        stops = new Array(s.journeyDetails.stops).fill("Stop");
      }

      return {
        // Use RID-Destination to avoid collisions for the same train on different boards
        id: `${s.rid || Math.random().toString(36).substr(2, 9)}-${destination || 'board'}`,
        time: departureTime,
        destination: s.destination?.[0]?.locationName || "Unknown",
        status: status,
        platform: s.platform || "TBC",
        duration: duration > 0 ? duration : 0,
        eta: eta,
        stops: stops
      };
    });

    const departures = await Promise.all(departurePromises);
    return departures;
  } catch (error: any) {
    console.error(`Scraping failed for ${crs}:`, error.message);
    return [];
  }
}

// --- Engineering Works Scraping ---
// Helper to parse National Rail's Rich Text JSON format
function parseNreRichText(node: any): string {
  if (!node) return "";
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(parseNreRichText).join("");

  let text = "";
  if (node.nodeType === 'text') {
    text += node.value || "";
  }

  if (node.content && Array.isArray(node.content)) {
    text += node.content.map(parseNreRichText).join("");
  }

  return text;
}

async function scrapeEngineeringWorks(operators: string[] = ['LE']) {
  const allDisruptions: string[] = [];
  const seenSlugs = new Set<string>();

  for (const code of operators) {
    try {
      const url = `https://www.nationalrail.co.uk/status-and-disruptions/?operatorCode=${code}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      const nextDataScript = $('#__NEXT_DATA__').html();

      if (!nextDataScript) continue;

      const nextData = JSON.parse(nextDataScript);

      // Correct path for the Status & Disruptions page JSON
      const disruptionsData = nextData.props?.pageProps?.data?.disruptionsData;

      if (!disruptionsData) {
        console.warn(`No disruptionsData found for operator ${code} at the expected path.`);
        continue;
      }

      // Extract Unplanned (Incidents), Planned (Engineering), and PlannedIncidents
      const unplanned = disruptionsData.unplannedIncidents || [];
      const planned = disruptionsData.engineeringWorks || [];
      const plannedInc = disruptionsData.plannedIncidents || [];

      [...unplanned, ...planned, ...plannedInc].forEach((item: any) => {
        if (item.slug && !seenSlugs.has(item.slug)) {
          seenSlugs.add(item.slug);

          // Get the summary text - usually in summary.json
          let summary = "";
          if (item.summary?.json) {
            summary = parseNreRichText(item.summary.json).trim();
          } else if (item.summary) {
            summary = item.summary.toString().trim();
          }

          if (summary && summary.length > 10) {
            allDisruptions.push(summary);
          }
        }
      });
    } catch (e) {
      console.error(`Status fetch failed for operator ${code}:`, e instanceof Error ? e.message : e);
    }
  }

  if (allDisruptions.length > 0) {
    // Prioritize and limit
    return allDisruptions.slice(0, 5);
  }

  return ["No major service disruptions reported on the network today."];
}

// --- Rail Integration (Scraping Fallback) ---
app.get("/api/rail/departures", async (req, res) => {
  const crs = (req.query.crs as string || 'SNF').toUpperCase();
  const destinationsStr = req.query.destinations as string || '';
  const destinations = destinationsStr.split(',').filter(Boolean);
  const destCrsStr = req.query.destCrs as string || '';
  const destCrsList = destCrsStr.split(',').filter(Boolean);

  const token = process.env.NATIONAL_RAIL_TOKEN;

  // Token fallback
  if (token) {
    try {
      const results: Record<string, any[]> = {};

      // If no specific destinations provided, just get the general board
      const targets = destinations.length > 0 ? destinations : [null];
      console.log(`Targets: ${targets}, CrsList: ${destCrsList}, origin: ${crs}`);

      for (let i = 0; i < targets.length; i++) {
        const dest = targets[i];
        let url;
        let params: any = {
          numRows: 149,
          timeWindow: 120,
        };

        const destCrs = dest ? (destCrsList[i] || null) : null;

        if (destCrs) {
          // OpenLDBWS trick: Large origin stations (like STP) truncate results heavily.
          // To see all trains *to* a smaller destination, query the *destination* station's Arrivals board
          // and filter by the origin station.
          url = `https://api1.raildata.org.uk/1010-live-arrival-and-departure-boards-arr-and-dep1_1/LDBWS/api/20220120/GetArrDepBoardWithDetails/${destCrs}`;
          params.filterCrs = crs;
          params.filterType = 'from';
        } else {
          // Generic departures board for the origin
          url = `https://api1.raildata.org.uk/1010-live-arrival-and-departure-boards-arr-and-dep1_1/LDBWS/api/20220120/GetDepBoardWithDetails/${crs}`;
          params.filterType = 'to';
        }
        console.log(`Querying ${url} with params`, params);

        let combinedServices: any[] = [];
        const offsets = [0, 40, 80];

        // OpenLDBWS heavily restricts the number of rows returned per query (usually 10-15 max)
        // even if numRows is set to 149. To get a comprehensive list covering up to 2 hours,
        // we must chunk the requests using timeOffset.
        for (const offset of offsets) {
          params.timeOffset = offset;
          try {
            const response = await axios.get(url, {
              params,
              headers: {
                'x-apikey': token,
                'Accept': 'application/json'
              },
              timeout: 10000
            });
            const board = response.data;
            const services = board.trainServices || [];
            combinedServices = combinedServices.concat(Array.isArray(services) ? services : [services]);
          } catch (e) {
            console.error(`Error fetching offset ${offset} for ${dest}:`, e);
          }
        }

        // Deduplicate services by ID, as time windows might overlap
        const uniqueServicesMap = new Map();
        for (const s of combinedServices) {
          if (s && s.serviceID) {
            uniqueServicesMap.set(s.serviceID, s);
          }
        }
        const uniqueServices = Array.from(uniqueServicesMap.values());

        // If we got valid services here, we know the API worked, so format and return.
        // However, if we didn't, we will continue and let the failure trigger the fallback.
        console.log(`[RDM] ${destCrs || crs} uniqueServices count:`, uniqueServices.length);
        if (uniqueServices.length > 0) {
          const formattedServices = uniqueServices.map((s: any) => {
            let depTime = "";
            let arrTime = "";
            let depStatus = "";
            let duration = 0;
            let destName = s.destination?.[0]?.locationName || dest || "Unknown";
            let allStops: any[] = [];

            if (destCrs) {
              // This is an Arrival Board response at the destination.
              // The root object represents the ARRIVAL at `destCrs`.
              // The departure from our home station (`crs` = STP) is in `previousCallingPoints`.
              const arrStd = s.sta || s.std; // Arrival Board sometimes uses sta instead of std
              const arrEtd = s.eta || s.etd;
              arrTime = arrEtd && arrEtd !== "On time" && arrEtd !== "Delayed" && arrEtd !== "Cancelled" ? arrEtd : arrStd;

              const prevPoints = s.previousCallingPoints?.[0]?.callingPoint || [];
              allStops = [...prevPoints];

              // Find the origin station (e.g. St Pancras) in previous points
              const originStop = prevPoints.find((cp: any) => cp.crs === crs || cp.locationName.toLowerCase().includes("pancras"));

              if (originStop) {
                depTime = originStop.et && originStop.et !== "On time" && originStop.et !== "Delayed" && originStop.et !== "Cancelled" ? originStop.et : originStop.st;
                depStatus = originStop.et === "On time" ? "On time" : (originStop.et || originStop.st);
              } else {
                // Fallback if origin isn't in previous points (shouldn't happen since we filter by it)
                depTime = arrTime;
                depStatus = "Unknown";
              }
            } else {
              // This is a Departure Board response at the origin.
              // The root object represents the DEPARTURE from our home station (`crs` = STP).
              // The arrival at the destination is in `subsequentCallingPoints`.
              const depStd = s.std;
              const depEtd = s.etd;
              depTime = depEtd && depEtd !== "On time" && depEtd !== "Delayed" && depEtd !== "Cancelled" ? depEtd : depStd;
              depStatus = depEtd === "On time" ? "On time" : depEtd;

              const subPoints = s.subsequentCallingPoints?.[0]?.callingPoint || [];
              allStops = [...subPoints];

              // Find the specific destination stop
              const targetStop = dest
                ? subPoints.find((cp: any) => cp.locationName.toLowerCase().includes(dest.toLowerCase()) || dest.toLowerCase().includes(cp.locationName.toLowerCase()))
                : null;

              if (targetStop || subPoints.length > 0) {
                const finalStop = targetStop || subPoints[subPoints.length - 1];
                arrTime = finalStop.et && finalStop.et !== "On time" && finalStop.et !== "Delayed" && finalStop.et !== "Cancelled" ? finalStop.et : finalStop.st;
                if (targetStop) {
                  destName = targetStop.locationName;
                }
              } else {
                arrTime = depTime; // Default ETA is departure time if we can't find arrival
              }
            }

            // Calculate simple duration in minutes
            if (depTime && arrTime && depTime.includes(':') && arrTime.includes(':')) {
              const [depH, depM] = depTime.split(':').map(Number);
              const [arrH, arrM] = arrTime.split(':').map(Number);

              let depTotalMins = depH * 60 + depM;
              let arrTotalMins = arrH * 60 + arrM;

              if (arrTotalMins < depTotalMins) {
                arrTotalMins += 24 * 60; // Next day
              }
              duration = arrTotalMins - depTotalMins;
            }

            return {
              id: s.serviceID,
              time: depTime || s.std, // Fallback to root std
              destination: destName,
              status: depStatus || "On time",
              platform: s.platform || "TBC",
              duration: duration,
              eta: arrTime || depTime || s.std,
              stops: allStops.map((cp: any) => {
                let time = cp.st || "";
                if (cp.et && cp.et !== "On time" && cp.et !== "Delayed" && cp.et !== "Cancelled") time = cp.et;
                return time ? `${cp.locationName} (${time})` : cp.locationName;
              }) || []
            };
          });

          if (dest) {
            results[dest] = formattedServices;
          } else {
            results["all"] = formattedServices;
          }
        }
      }

      // Only return if we actually got API results for at least one service
      if (Object.keys(results).length > 0 && Object.values(results).some(val => val.length > 0)) {
        return res.json({ departures: results });
      } else {
        console.log("Official REST API returned no results, falling back to scraping...");
      }
    } catch (error: any) {
      console.error("Official REST Rail API failed:", error.response?.status, error.response?.data || error.message);
      // Fall through to scraping
    }
  }

  // Fallback to Scraping for Rail Data
  try {
    const results: Record<string, any[]> = {};
    const targets = destinations.length > 0 ? destinations : [null];

    for (let i = 0; i < targets.length; i++) {
      const dest = targets[i];
      const destCrs = dest ? (destCrsList[i] || null) : null;
      if (dest) {
        // Provide the destination name, which National Rail accepts as a slug
        results[dest] = await scrapeRailDepartures(crs, dest);
      } else {
        results["all"] = await scrapeRailDepartures(crs);
      }
    }

    res.json({ departures: results });
  } catch (error: any) {
    console.error("Rail Fallback Error:", error.message);
    res.status(500).json({ error: "Failed to fetch rail data" });
  }
});

app.get("/api/rail/engineering", async (req, res) => {
  try {
    const operatorQuery = req.query.operator;
    let operators: string[] = [];

    if (Array.isArray(operatorQuery)) {
      operators = operatorQuery.map(op => String(op));
    } else if (typeof operatorQuery === 'string') {
      operators = [operatorQuery];
    } else {
      operators = ['LE']; // Default fallback
    }

    const works = await scrapeEngineeringWorks(operators);
    res.json({ works });
  } catch (error) {
    // Graceful fallback
    res.json({ works: ["Service information currently unavailable."] });
  }
});

// --- Rail Journey Config ---
app.get("/api/config/rail", (req, res) => {
  const configPath = path.resolve(process.cwd(), "config", "rail.yaml");
  if (!fs.existsSync(configPath)) {
    return res.json({ _configMissing: true });
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = yaml.load(raw) as any;
    if (!parsed?.homeStation || !parsed?.destinations) {
      return res.status(400).json({ _error: "rail.yaml must contain 'homeStation' and 'destinations'" });
    }
    res.json({
      homeStation: parsed.homeStation,
      operatorCodes: parsed.operatorCodes || (parsed.operatorCode ? [parsed.operatorCode] : ["LE"]),
      destinations: parsed.destinations,
      walkTimeMins: parsed.walkTimeMins || 10
    });
  } catch (e: any) {
    console.error("Failed to parse rail.yaml:", e.message);
    res.status(500).json({ _error: `Failed to parse rail.yaml: ${e.message}` });
  }
});

// --- Road Journey Config ---
app.get("/api/config/roads", (req, res) => {
  const configPath = path.resolve(process.cwd(), "config", "roads.yaml");
  if (!fs.existsSync(configPath)) {
    return res.json({ _configMissing: true, journeys: [] });
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = yaml.load(raw) as { journeys: any[] };
    if (!parsed?.journeys || !Array.isArray(parsed.journeys)) {
      return res.status(400).json({ _error: "roads.yaml must contain a top-level 'journeys' array" });
    }
    res.json({ journeys: parsed.journeys });
  } catch (e: any) {
    console.error("Failed to parse roads.yaml:", e.message);
    res.status(500).json({ _error: `Failed to parse roads.yaml: ${e.message}` });
  }
});

// --- Google Maps Distance Matrix Integration ---
app.get("/api/road/travel", async (req, res) => {
  const { origins, destinations, ids } = req.query;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    // Return 200 with a specific flag instead of 500
    return res.json({ _configRequired: true });
  }

  try {
    console.log(`Fetching road travel for ${origins} to ${destinations}`);
    const response = await axios.get("https://maps.googleapis.com/maps/api/distancematrix/json", {
      params: {
        origins,
        destinations,
        departure_time: "now",
        traffic_model: "best_guess",
        units: "imperial",
        key: apiKey,
      },
      timeout: 5000
    });

    const data = response.data;
    console.log(`Maps API Response Status: ${data.status}`);

    const results: Record<string, any> = {};

    if (data.status === "OK") {
      const idList = (ids as string || destinations as string).split("|");
      idList.forEach((destId: string, index: number) => {
        // With N origins and N destinations, we want the route from origin[i] to destination[i],
        // which sits at rows[i].elements[i] in the Distance Matrix response.
        const row = data.rows[index];
        if (!row) return;

        const element = row.elements[index];
        if (!element) return;

        if (element.status === "OK") {
          results[destId] = {
            travelTime: element.duration_in_traffic?.text || element.duration?.text || "--",
            trafficStatus: element.duration_in_traffic ? (element.duration_in_traffic.value > element.duration.value * 1.2 ? "Heavy traffic" : "Normal traffic") : "Normal traffic",
            distance: element.distance?.text || "--",
            summary: "Via main route"
          };
        } else {
          console.warn(`Element status for ${destId}: ${element.status}`);
        }
      });
    } else {
      console.error(`Maps API Error Status: ${data.status}`, data.error_message);
      return res.json({ _error: data.error_message || data.status });
    }

    res.json(results);
  } catch (error: any) {
    console.error("Maps API Error:", error.message);
    res.json({ _error: "Failed to fetch road data" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
