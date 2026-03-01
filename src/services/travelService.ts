import axios from "axios";

export interface TrainDeparture {
  id: string;
  time: string;
  destination: string;
  status: string;
  platform: string;
  duration: number;
  eta: string;
  stops: string[];
}

export interface RoadJourneyData {
  id: string;
  travelTime: string;
  trafficStatus: string;
  distance: string;
  summary: string;
}

export async function getLiveRoadTravel(journeys: { id: string, origin: string, destination: string }[]): Promise<Record<string, RoadJourneyData>> {
  try {
    const origins = journeys.map(j => j.origin).join("|");
    const destinations = journeys.map(j => j.destination).join("|");
    const ids = journeys.map(j => j.id).join("|");

    const response = await axios.get("/api/road/travel", {
      params: {
        origins,
        destinations,
        ids
      }
    });

    if (response.data._configRequired) {
      throw new Error("GOOGLE_MAPS_API_KEY not configured");
    }

    if (response.data._error) {
      throw new Error(response.data._error);
    }

    return response.data;
  } catch (error: any) {
    console.error("Error fetching live road data from backend:", error.message);
    throw error;
  }
}

export async function getLiveRailDepartures(origin: string, destinations: string[]): Promise<Record<string, TrainDeparture[]>> {
  try {
    // We'll make one call to get all departures from the origin
    const response = await axios.get("/api/rail/departures", {
      params: {
        crs: origin,
        destinations: destinations.join(",")
      }
    });

    const data = response.data.departures;

    // If data is an object (not an array), it's already grouped by the backend scraper
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data;
    }

    // Fallback: data is a flat array (from Official API or old scraping logic)
    const allDepartures = Array.isArray(data) ? data : [];
    const results: Record<string, TrainDeparture[]> = {};

    destinations.forEach(dest => {
      // Clean up destination name for matching (e.g. "Bristol (Temple Meads)" -> "bristol")
      const cleanDest = dest.split('(')[0].trim().toLowerCase();

      results[dest] = allDepartures.filter(dep => {
        const cleanDepDest = dep.destination.toLowerCase();
        return cleanDepDest.includes(cleanDest) || cleanDest.includes(cleanDepDest) ||
          dep.stops.some(stop => {
            const cleanStop = stop.toLowerCase();
            return cleanStop.includes(cleanDest) || cleanDest.includes(cleanStop);
          });
      });
    });

    return results;
  } catch (error) {
    console.error("Error fetching live rail data from backend:", error);
    throw error;
  }
}
