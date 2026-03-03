/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Clock,
  Car,
  Train,
  MapPin,
  ChevronRight,
  ArrowRight,
  Smartphone,
  Maximize2,
  RefreshCw,
  AlertCircle,
  Calendar,
  Info
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import axios from 'axios';
import { getLiveRailDepartures, getLiveRoadTravel, type TrainDeparture as TravelDeparture } from './services/travelService';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
// Config shape loaded from roads.yaml — live data fields are stored separately in roadData state
interface RoadJourney {
  id: string;
  origin: string;
  destination: string;
  destinationName: string;
  mapQuery?: string;
}

interface RailConfig {
  homeStation: { name: string; crs: string };
  operatorCodes: string[];
  destinations: { id: string; name: string }[];
}

const WALK_TIME_MINS = 5;


export default function App() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedRailDest, setSelectedRailDest] = useState<string | null>(null);
  const [expandedRoadCardId, setExpandedRoadCardId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [railData, setRailData] = useState<Record<string, TravelDeparture[]>>({});
  const [roadData, setRoadData] = useState<Record<string, { travelTime: string, trafficStatus: string, distance: string, summary: string }>>({});
  const [engineeringWorks, setEngineeringWorks] = useState<string[]>([]);
  const [showToast, setShowToast] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [railLastUpdated, setRailLastUpdated] = useState<Date | null>(null);
  const [roadLastUpdated, setRoadLastUpdated] = useState<Date | null>(null);
  const [isRailRefreshing, setIsRailRefreshing] = useState(false);
  const [isRoadRefreshing, setIsRoadRefreshing] = useState(false);
  const [qrModal, setQrModal] = useState<{ url: string; label: string } | null>(null);
  const [roadJourneys, setRoadJourneys] = useState<RoadJourney[]>([]);
  const [roadConfigMissing, setRoadConfigMissing] = useState(false);
  const [railConfigMissing, setRailConfigMissing] = useState(false);
  const [railConfig, setRailConfig] = useState<RailConfig | null>(null);
  const [googleMapsKeyMissing, setGoogleMapsKeyMissing] = useState(false);

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-refresh timers — set up after functions are defined (see below)

  // Initial data load
  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        // Fetch Rail config from YAML
        let initialRailConfig: RailConfig | null = null;
        let isMissingRailConfig = false;
        try {
          const configRes = await axios.get('/api/config/rail');
          if (configRes.data._configMissing) {
            isMissingRailConfig = true;
            setRailConfigMissing(true);
          } else {
            initialRailConfig = configRes.data;
            setRailConfig(initialRailConfig);
          }
        } catch (e) {
          console.error('Failed to fetch rail config', e);
          isMissingRailConfig = true;
          setRailConfigMissing(true);
        }

        if (!isMissingRailConfig && initialRailConfig) {
          // Fetch Rail Data
          const dests = initialRailConfig.destinations.map((d: any) => ({ name: d.name, crs: d.crs }));
          const liveRail = await getLiveRailDepartures(initialRailConfig.homeStation.crs, dests);

          const mappedRail: Record<string, TravelDeparture[]> = {};
          initialRailConfig.destinations.forEach((dest: any) => {
            // The travelService now returns exact keys matching dest.name
            mappedRail[dest.id] = liveRail[dest.name] || [];
          });
          setRailData(mappedRail);
          setRailLastUpdated(new Date());

          // Fetch Engineering Works
          try {
            const params = new URLSearchParams({ crs: initialRailConfig.homeStation.crs });
            const ops = initialRailConfig.operatorCodes || (initialRailConfig as any).operatorCode;
            if (ops) {
              const opsArray = Array.isArray(ops) ? ops : [ops];
              opsArray.forEach((op: string) => params.append('operator', op));
            }
            const engResponse = await axios.get('/api/rail/engineering', { params });
            setEngineeringWorks(engResponse.data.works || []);
          } catch (e) {
            console.error("Failed to fetch engineering works", e);
          }
        }

        // Fetch Road config from YAML
        let initialJourneys: any[] = [];
        let isMissingConfig = false;
        try {
          const configRes = await axios.get('/api/config/roads');
          if (configRes.data._configMissing) {
            isMissingConfig = true;
            setRoadConfigMissing(true);
          } else {
            const rawJourneys = configRes.data.journeys || [];
            // Map over journeys to ensure mapQuery exists
            initialJourneys = rawJourneys.map((j: any) => ({
              ...j,
              mapQuery: j.mapQuery || encodeURIComponent(`${j.origin} to ${j.destination}`)
            }));
            setRoadJourneys(initialJourneys);
          }
        } catch (e) {
          console.error('Failed to fetch road config', e);
          isMissingConfig = true;
          setRoadConfigMissing(true);
        }

        // Fetch Road (Only during active window)
        const hours = new Date().getHours();
        if (hours >= 6 && hours < 24 && !isMissingConfig) {
          try {
            const journeyParams = initialJourneys.map(j => ({ id: j.id, origin: j.origin, destination: j.destination }));
            if (journeyParams.length > 0) {
              const liveRoad = await getLiveRoadTravel(journeyParams);
              setRoadData(liveRoad);
              setRoadLastUpdated(new Date());
            }
          } catch (e: any) {
            console.error("Failed to fetch road travel data", e);
            if (e?.message === 'GOOGLE_MAPS_API_KEY not configured') {
              setGoogleMapsKeyMissing(true);
            }
            // We don't set global apiError here so rail can still work
          }
        }

        setApiError(null);
      } catch (error: any) {
        console.error("Failed to fetch initial live data", error);
        setApiError("Live travel data currently unavailable. Check API configuration.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchInitialData();
  }, []);

  const refreshRailData = async () => {
    if (!railConfig) return false;
    try {
      const dests = railConfig.destinations.map(d => ({ name: d.name, crs: (d as any).crs }));
      const liveRail = await getLiveRailDepartures(railConfig.homeStation.crs, dests);

      const mappedRail: Record<string, TravelDeparture[]> = {};
      railConfig.destinations.forEach(dest => {
        const key = Object.keys(liveRail).find(k => k === dest.name) ||
          Object.keys(liveRail).find(k => k.toLowerCase().includes(dest.name.toLowerCase().split(' ')[0]));
        mappedRail[dest.id] = key ? liveRail[key] : [];
      });
      setRailData(mappedRail);
      setRailLastUpdated(new Date());

      const params = new URLSearchParams({ crs: railConfig.homeStation.crs });
      const ops = railConfig.operatorCodes || (railConfig as any).operatorCode;
      if (ops) {
        const opsArray = Array.isArray(ops) ? ops : [ops];
        opsArray.forEach((op: string) => params.append('operator', op));
      }
      const engResponse = await axios.get('/api/rail/engineering', { params });

      setEngineeringWorks(engResponse.data.works || []);
      return true;
    } catch (error) {
      console.error("Rail refresh failed", error);
      return false;
    }
  };

  const refreshRoadData = async (manual: boolean = true) => {
    try {
      const hours = new Date().getHours();
      // Block automated refreshes outside 6AM-12AM
      if (!manual && (hours < 6 || hours >= 24)) {
        console.log("Skipping automated road refresh (outside active window)");
        return true;
      }

      const journeyParams = roadJourneys.map(j => ({ id: j.id, origin: j.origin, destination: j.destination }));
      const liveRoad = await getLiveRoadTravel(journeyParams);
      setRoadData(liveRoad);
      setRoadLastUpdated(new Date());
      setGoogleMapsKeyMissing(false);
      return true;
    } catch (error: any) {
      console.error("Road refresh failed", error);
      if (error?.message === 'GOOGLE_MAPS_API_KEY not configured') {
        setGoogleMapsKeyMissing(true);
      }
      return false;
    }
  };

  // Refs to always call the latest version of each refresh fn from the intervals
  const refreshRailRef = useRef(refreshRailData);
  const refreshRoadRef = useRef(refreshRoadData);
  useEffect(() => { refreshRailRef.current = refreshRailData; });
  useEffect(() => { refreshRoadRef.current = refreshRoadData; });

  // Auto-refresh Rail every 5 minutes
  useEffect(() => {
    const railTimer = setInterval(() => {
      refreshRailRef.current();
    }, 5 * 60 * 1000);
    return () => clearInterval(railTimer);
  }, []);

  // Auto-refresh Road every 25 minutes (Optimized for GCP Free Tier)
  useEffect(() => {
    const roadTimer = setInterval(() => {
      refreshRoadRef.current(false);
    }, 25 * 60 * 1000);
    return () => clearInterval(roadTimer);
  }, []);

  const handleRefresh = async () => {
    setIsLoading(true);
    const [railOk, roadOk] = await Promise.all([refreshRailData(), refreshRoadData()]);

    if (railOk && roadOk) {
      setApiError(null);
      triggerToast("Live data updated");
    } else {
      setApiError("Partial data update failed. Check connection.");
      triggerToast("Update failed");
    }
    setIsLoading(false);
  };

  const triggerToast = (msg: string) => {
    setShowToast(msg);
    setTimeout(() => setShowToast(null), 3000);
  };

  const buildMapsUrl = (origin: string, destination: string) => {
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    return url.toString();
  };

  const handleStartNavigation = (origin: string, destination: string, e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(buildMapsUrl(origin, destination), "_blank");
  };

  const handleSendToPhone = (origin: string, destination: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = buildMapsUrl(origin, destination);
    const showModal = () => setQrModal({ url, label: `${origin} → ${destination}` });
    if (navigator.share) {
      navigator.share({ title: 'Route Details', url })
        .catch(() => showModal()); // fall back to modal if share is rejected/unavailable
    } else {
      showModal();
    }
  };

  const expandedJourney = useMemo(() =>
    roadJourneys.find(j => j.id === expandedRoadCardId),
    [expandedRoadCardId, roadJourneys]
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* API Error Warning */}
      <AnimatePresence>
        {apiError && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-red-500 text-white overflow-hidden"
          >
            <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertCircle size={18} />
                <span>{apiError}</span>
              </div>
              <div className="text-xs opacity-80 hidden sm:block">
                Required: GOOGLE_MAPS_API_KEY (Rail is currently using Web Scraping fallback)
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Google Maps Key Missing Banner */}
      <AnimatePresence>
        {googleMapsKeyMissing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-amber-500 text-white overflow-hidden"
          >
            <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertCircle size={18} />
                <span>Road travel data unavailable — <code className="bg-amber-600 px-1 rounded text-xs">GOOGLE_MAPS_API_KEY</code> is not configured.</span>
              </div>
              <button
                onClick={() => setGoogleMapsKeyMissing(false)}
                className="text-white/80 hover:text-white text-xs underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="bg-brand-primary p-2 rounded-lg text-white">
            <Train size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{railConfig?.homeStation?.name ? `${railConfig.homeStation.name} Travel Hub` : 'Travel Hub'}</h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Live Departures & Traffic</p>
          </div>
        </div>

        <div className="text-right">
          <div className="flex items-center gap-2 text-slate-900 font-mono text-2xl font-bold">
            <Clock size={20} className="text-brand-primary" />
            {format(currentTime, 'HH:mm:ss')}
          </div>
          <div className="flex items-center justify-end gap-1 text-slate-500 text-sm">
            <Calendar size={14} />
            {format(currentTime, 'EEEE, do MMMM yyyy')}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Left Column: Car Travel */}
        <section className="lg:col-span-5 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Car className="text-slate-600" size={20} />
              Road Travel
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Auto-refresh: 25m (6am - Midnight)</span>
              <button
                onClick={async () => { setIsRoadRefreshing(true); await refreshRoadData(true); setIsRoadRefreshing(false); }}
                className="p-2 hover:bg-slate-200 rounded-full transition-all"
                title="Refresh road data"
              >
                <RefreshCw size={18} className={cn("text-slate-500", isRoadRefreshing && "animate-spin")} />
              </button>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3">
            <Info className="text-blue-500 shrink-0" size={20} />
            <div className="space-y-1">
              <p className="text-sm font-bold text-blue-900">Live Road Status</p>
              {isRoadRefreshing || (isLoading && Object.keys(roadData).length === 0) ? (
                <p className="text-sm text-blue-800">Fetching live road data...</p>
              ) : Object.keys(roadData).length === 0 ? (
                <p className="text-sm text-blue-800">
                  {apiError
                    ? 'Live road status unavailable — Google Maps API key not configured.'
                    : 'Road data unavailable. Try refreshing.'}
                </p>
              ) : (
                <ul className="space-y-1">
                  {roadJourneys.map(journey => {
                    const live = roadData[journey.id];
                    if (!live) return null;
                    return (
                      <li key={journey.id} className="text-sm text-blue-800 flex items-center gap-2">
                        <span className="font-semibold">{journey.destinationName}:</span>
                        <span>{live.trafficStatus}</span>
                        <span className="text-blue-600 font-mono font-bold">({live.travelTime})</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-6">
            {roadConfigMissing ? (
              <div className="glass-card rounded-2xl p-8 text-center">
                <Car size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-500">Road routes not configured</p>
                <p className="text-xs text-slate-400 mt-1">Mount a <code className="bg-slate-100 px-1 rounded">config/roads.yaml</code> file to enable road travel cards.</p>
              </div>
            ) : (
              roadJourneys.map((journey) => {
                const live = roadData[journey.id] || { travelTime: '--', trafficStatus: 'Unavailable', distance: '--', summary: '--' };
                return (
                  <motion.div
                    key={journey.id}
                    layoutId={`road-travel-card-${journey.id}`}
                    className="glass-card rounded-2xl overflow-hidden group cursor-pointer relative"
                    onClick={() => setExpandedRoadCardId(journey.id)}
                  >
                    <div className="p-5 border-b border-slate-100 flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">To</span>
                          <h3 className="text-xl font-bold text-slate-900">{journey.destinationName}</h3>
                        </div>
                        <div className="flex items-center gap-2 text-emerald-600 font-medium">
                          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          {live.travelTime}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-slate-500 mb-1">{live.trafficStatus}</div>
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={(e) => handleSendToPhone(journey.origin, journey.destination, e)}
                            className="p-2 bg-slate-100 rounded-lg text-slate-600 hover:bg-brand-primary hover:text-white transition-colors"
                            title="Send to phone"
                          >
                            <Smartphone size={18} />
                          </button>
                          <button className="p-2 bg-slate-100 rounded-lg text-slate-600">
                            <Maximize2 size={18} />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="relative h-[240px] bg-slate-200">
                      <iframe
                        width="100%"
                        height="100%"
                        style={{ border: 0 }}
                        src={`https://maps.google.com/maps?saddr=${encodeURIComponent(journey.origin)}&daddr=${encodeURIComponent(journey.destination)}&t=&z=12&ie=UTF8&iwloc=&output=embed`}
                        allowFullScreen
                        className="w-full h-full pointer-events-none"
                        title={`Map ${journey.id}`}
                      ></iframe>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="bg-white/90 px-4 py-2 rounded-full shadow-xl border border-slate-200 flex items-center gap-2">
                          <MapPin size={16} className="text-red-500" />
                          <div className="w-24 h-1 bg-slate-300 rounded-full relative overflow-hidden">
                            <div className="absolute inset-0 bg-brand-primary w-2/3" />
                          </div>
                          <MapPin size={16} className="text-brand-primary" />
                        </div>
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
                      <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                        <div className="bg-white/90 backdrop-blur px-3 py-2 rounded-lg shadow-lg">
                          <div className="text-[10px] font-bold text-slate-400 uppercase">Route Summary</div>
                          <div className="text-sm font-semibold">{live.summary} • {live.distance}</div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => handleStartNavigation(journey.origin, journey.destination, e)}
                            className="px-4 py-2 bg-brand-primary text-white rounded-full text-sm font-bold shadow-lg hover:scale-105 transition-transform"
                          >
                            Start Navigation
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>

          {/* Full Screen Map Overlay */}
          <AnimatePresence>
            {expandedRoadCardId && expandedJourney && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-10 bg-slate-900/60 backdrop-blur-sm"
                onClick={() => setExpandedRoadCardId(null)}
              >
                <motion.div
                  layoutId={`road-travel-card-${expandedRoadCardId}`}
                  className="bg-white w-full max-w-5xl h-full max-h-[85vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
                    <div>
                      <h3 className="text-2xl font-bold text-slate-900">{expandedJourney.origin} to {expandedJourney.destinationName}</h3>
                      <p className="text-slate-500">Route Overview</p>
                    </div>
                    <button
                      onClick={() => setExpandedRoadCardId(null)}
                      className="p-3 bg-slate-100 rounded-full text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      <RefreshCw size={24} className="rotate-45" />
                    </button>
                  </div>

                  <div className="flex-1 relative bg-slate-100">
                    <iframe
                      width="100%"
                      height="100%"
                      style={{ border: 0 }}
                      src={`https://maps.google.com/maps?saddr=${encodeURIComponent(expandedJourney.origin)}&daddr=${encodeURIComponent(expandedJourney.destination)}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                      allowFullScreen
                      className="w-full h-full"
                      title="Google Maps Route Expanded"
                    ></iframe>

                    {/* Map UI Elements - Overlaying on the real map */}
                    <div className="absolute top-6 left-6 space-y-3 pointer-events-none">
                      <div className="bg-white/95 backdrop-blur p-4 rounded-2xl shadow-xl border border-slate-100 max-w-xs">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                            <Car size={20} />
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-slate-900">{roadData[expandedRoadCardId]?.travelTime ?? '--'}</div>
                            <div className="text-xs font-bold text-emerald-600 uppercase">Live Traffic</div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <div className="w-2 h-2 rounded-full bg-slate-300" />
                            <span>{roadData[expandedRoadCardId]?.distance ?? '--'} {roadData[expandedRoadCardId]?.summary ?? ''}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <div className="w-2 h-2 rounded-full bg-amber-400" />
                            <span>{roadData[expandedRoadCardId]?.trafficStatus ?? 'Unavailable'}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-4">
                      <button
                        onClick={(e) => handleStartNavigation(expandedJourney.origin, expandedJourney.destination, e)}
                        className="px-8 py-4 bg-brand-primary text-white rounded-2xl font-bold shadow-2xl hover:scale-105 transition-transform flex items-center gap-2"
                      >
                        <MapPin size={20} />
                        Open in Google Maps
                      </button>
                      <button
                        onClick={(e) => handleSendToPhone(expandedJourney.origin, expandedJourney.destination, e)}
                        className="px-8 py-4 bg-white text-slate-900 rounded-2xl font-bold shadow-2xl hover:scale-105 transition-transform border border-slate-200 flex items-center gap-2"
                      >
                        <Smartphone size={20} />
                        Send to Device
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Right Column: Rail Travel */}
        <section className="lg:col-span-7 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Train className="text-slate-600" size={20} />
              {railConfig ? `${railConfig.homeStation.name} Departures` : 'Rail Departures'}
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-slate-300 uppercase">Auto-refresh: 5m</span>
              <button
                onClick={async () => { setIsRailRefreshing(true); await refreshRailData(); setIsRailRefreshing(false); }}
                className="p-2 bg-slate-100 rounded-lg transition-all"
                title="Refresh rail data"
              >
                <RefreshCw size={18} className={cn("text-slate-500", isRailRefreshing && "animate-spin")} />
              </button>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Source: National Rail Live {railConfig && `(>${railConfig.walkTimeMins || 10}m walk)`}
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex gap-3">
            <AlertCircle className="text-amber-500 shrink-0" size={20} />
            <div className="space-y-1">
              <p className="text-sm font-bold text-amber-900">Planned Engineering Works</p>
              <div className="text-sm text-amber-800 leading-relaxed space-y-2">
                {engineeringWorks.length > 0 ? (
                  engineeringWorks.map((work, i) => (
                    <p key={i}>{work}</p>
                  ))
                ) : (
                  <p>No major engineering works reported for today. Check back later for weekend updates.</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {railConfigMissing ? (
              <div className="glass-card rounded-2xl p-8 text-center">
                <Train size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-500">Rail routes not configured</p>
                <p className="text-xs text-slate-400 mt-1">Mount a <code className="bg-slate-100 px-1 rounded">config/rail.yaml</code> file to enable rail departures.</p>
              </div>
            ) : (
              railConfig?.destinations.map((dest) => {
                const rawDepartures = railData[dest.id] || [];
                const isSelected = selectedRailDest === dest.id;

                // Filter for reachable trains (current time + 5 mins)
                const reachableDepartures = rawDepartures.filter(train => {
                  if (!train.time || !train.time.includes(':')) return true; // Don't filter out if time format is unexpected

                  const [hours, minutes] = train.time.split(':').map(Number);
                  if (isNaN(hours) || isNaN(minutes)) return true;

                  const trainDate = new Date(currentTime);
                  trainDate.setHours(hours, minutes, 0, 0);

                  // Handle wrap-around for late night trains if necessary
                  if (trainDate.getTime() < currentTime.getTime() - 12 * 60 * 60 * 1000) {
                    trainDate.setDate(trainDate.getDate() + 1);
                  }

                  const limitDate = new Date(currentTime.getTime() + (railConfig?.walkTimeMins || 10) * 60 * 1000);
                  return trainDate >= limitDate;
                });

                // Use reachable departures for all following logic
                const departures = reachableDepartures;

                // Find fastest arrival
                const sortedByDuration = [...departures].sort((a, b) => a.duration - b.duration);
                const fastestId = sortedByDuration[0]?.id;

                const sortedByArrival = [...departures].sort((a, b) => a.eta.localeCompare(b.eta));
                const soonestId = sortedByArrival[0]?.id;

                const slowestId = sortedByDuration[sortedByDuration.length - 1]?.id;

                return (
                  <motion.div
                    key={dest.id}
                    layout
                    className={cn(
                      "glass-card rounded-2xl transition-all duration-300",
                      isSelected ? "ring-2 ring-brand-primary shadow-lg" : "hover:shadow-md"
                    )}
                  >
                    <div
                      className="p-5 flex justify-between items-center cursor-pointer"
                      onClick={() => setSelectedRailDest(isSelected ? null : dest.id)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600">
                          <MapPin size={24} />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-slate-900">{dest.name}</h3>
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-1">
                            {departures.length === 0 ? (
                              <span className="text-sm font-mono font-bold text-brand-primary">No live times</span>
                            ) : departures[0].id === soonestId ? (
                              /* Next IS Best — single row */
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono font-bold text-brand-primary">
                                  Best: {departures[0].time}
                                </span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tight bg-blue-100 text-blue-700 border border-blue-200">
                                  Gets you there fastest
                                </span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tight bg-emerald-100 text-emerald-700">
                                  Arrives {departures[0].eta}
                                </span>
                                <span className={cn(
                                  "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tight",
                                  departures[0].status === 'On time' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                                )}>
                                  {departures[0].status}
                                </span>
                              </div>
                            ) : (
                              /* Best and Next are different — Best leads */
                              <>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase">Best:</span>
                                  <span className="text-sm font-mono font-bold text-emerald-600">
                                    {sortedByArrival[0].time}
                                  </span>
                                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tight bg-emerald-100 text-emerald-700">
                                    Arrives {sortedByArrival[0].eta}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase">Next:</span>
                                  <span className="text-sm font-mono font-bold text-brand-primary">
                                    {departures[0].time}
                                  </span>
                                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tight bg-emerald-100 text-emerald-700">
                                    Arrives {departures[0].eta}
                                  </span>
                                  <span className={cn(
                                    "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tight",
                                    departures[0].status === 'On time' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                                  )}>
                                    {departures[0].status}
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className={cn("text-slate-400 transition-transform", isSelected && "rotate-90")} />
                    </div>

                    <AnimatePresence>
                      {isSelected && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden border-t border-slate-100"
                        >
                          <div className="p-0">
                            <div className="grid grid-cols-12 px-5 py-2 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              <div className="col-span-2">Dep</div>
                              <div className="col-span-4">Status</div>
                              <div className="col-span-2">Plat</div>
                              <div className="col-span-2">Dur</div>
                              <div className="col-span-2 text-right">ETA</div>
                            </div>
                            {departures.length === 0 ? (
                              <div className="p-10 text-center">
                                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 mx-auto mb-3">
                                  <AlertCircle size={24} />
                                </div>
                                <p className="text-sm font-medium text-slate-500">No live departures found for this destination.</p>
                                <p className="text-xs text-slate-400 mt-1">Try refreshing in a few moments.</p>
                              </div>
                            ) : departures.map((train) => (
                              <div
                                key={train.id}
                                className="train-row px-5 py-4 grid grid-cols-12 items-center group relative"
                              >
                                <div className="col-span-2 font-mono font-bold text-slate-900">{train.time}</div>
                                <div className="col-span-4">
                                  <span className={cn(
                                    "text-sm font-medium",
                                    train.status === 'On time' ? "text-emerald-600" : "text-red-600"
                                  )}>
                                    {train.status}
                                  </span>
                                </div>
                                <div className="col-span-2 text-sm font-bold text-slate-500">{train.platform}</div>
                                <div className="col-span-2">
                                  <span className={cn(
                                    "text-xs px-2 py-1 rounded-md font-bold",
                                    train.id === fastestId && "bg-emerald-500 text-white",
                                    train.id === slowestId && "bg-red-500 text-white",
                                    train.id !== fastestId && train.id !== slowestId && "bg-slate-100 text-slate-600"
                                  )}>
                                    {train.duration}m
                                  </span>
                                </div>
                                <div className="col-span-2 text-right font-mono text-sm text-slate-400">
                                  {train.eta}
                                </div>

                                {/* Hover Detail: Calling Points */}
                                <div className="absolute inset-x-0 -bottom-12 bg-slate-900 text-white p-3 rounded-lg text-xs z-10 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-xl mx-5">
                                  <div className="font-bold mb-1 uppercase text-[10px] text-slate-400">Calling at:</div>
                                  <div className="flex flex-wrap gap-x-2 gap-y-1">
                                    {train.stops.map((stop, idx) => (
                                      <React.Fragment key={stop}>
                                        <span>{stop}</span>
                                        {idx < train.stops.length - 1 && <ArrowRight size={10} className="inline mt-0.5" />}
                                      </React.Fragment>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="p-4 bg-slate-50 flex justify-center">
                            <button className="text-xs font-bold text-brand-primary flex items-center gap-1 hover:underline">
                              View Full Journey Details <ChevronRight size={14} />
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })
            )}
          </div>
        </section>
      </main>

      {/* QR Code Share Modal */}
      <AnimatePresence>
        {qrModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setQrModal(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl p-8 flex flex-col items-center gap-5 max-w-sm w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Send to Device</p>
                <p className="text-sm font-semibold text-slate-700">{qrModal.label}</p>
              </div>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrModal.url)}`}
                alt="QR Code for route"
                className="w-48 h-48 rounded-xl border border-slate-100"
              />
              <p className="text-xs text-slate-400 text-center">Scan with your phone camera to open in Google Maps</p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => { navigator.clipboard.writeText(qrModal.url); triggerToast("Link copied!"); }}
                  className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors"
                >
                  Copy Link
                </button>
                <button
                  onClick={() => setQrModal(null)}
                  className="flex-1 py-2 bg-brand-primary text-white rounded-xl text-sm font-bold hover:opacity-90 transition-opacity"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer / Status Bar */}
      <footer className="bg-white border-t border-slate-200 px-6 py-3 flex justify-between items-center text-xs text-slate-500">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            System Online
          </div>
          <div className="flex items-center gap-3">
            <span className="font-bold text-slate-400 uppercase tracking-wider">Last updated:</span>
            <div className="flex items-center gap-1">
              <Train size={12} />
              Rail: {railLastUpdated ? format(railLastUpdated, 'HH:mm:ss') : '—'}
            </div>
            <div className="flex items-center gap-1">
              <Car size={12} />
              Road: {roadLastUpdated ? format(roadLastUpdated, 'HH:mm:ss') : '—'}
            </div>
          </div>
        </div>
      </footer>

      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm font-medium">{showToast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div >
  );
}
