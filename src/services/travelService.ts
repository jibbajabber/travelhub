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

export async function getLiveRailDepartures(origin: string, destinations: { name: string, crs: string }[]): Promise<Record<string, TrainDeparture[]>> {
  try {
    // We'll make one call to get all departures from the origin
    const response = await axios.get("/api/rail/departures", {
      params: {
        crs: origin,
        destinations: destinations.map(d => d.name).join(","),
        destCrs: destinations.map(d => d.crs).join(",")
      }
    });

    const data = response.data.departures;

    // The backend now returns an object grouped by destination query
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const results: Record<string, TrainDeparture[]> = {};
      destinations.forEach(dest => {
        // The API maps exactly to the destination string we passed in
        const cleanKey = Object.keys(data).find(k => k.toLowerCase() === dest.name.toLowerCase());
        results[dest.name] = cleanKey ? data[cleanKey] : [];
      });
      return results;
    }

    // Fallback: This shouldn't happen with the new REST API but kept for safety
    return {};
  } catch (error) {
    console.error("Error fetching live rail data from backend:", error);
    throw error;
  }
}
