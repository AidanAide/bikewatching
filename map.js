import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

const INPUT_BLUEBIKES_JSON_URL = 'https://gbfs.bluebikes.com/gbfs/en/station_information.json';
const INPUT_BLUEBIKES_CSV_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiYWlkYW5haWRlIiwiYSI6ImNtd2U4cnV3bzA1MGQyenBwMGx6dmFiZHoifQ.cP3MJugDBeRnbwjBTrVWhg';


// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );
  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name ?? station.station_id;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#008000',
      'line-width': 3,
      'line-opacity': 0.8,
    },
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#008000',
      'line-width': 3,
      'line-opacity': 0.8,
    },
  });

  const svg = d3.select('#map').select('svg');

  let jsonData;
  try {
    jsonData = await d3.json(INPUT_BLUEBIKES_JSON_URL);
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  let trips;
  try {
    trips = await d3.csv(INPUT_BLUEBIKES_CSV_URL, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    });
    console.log('Loaded CSV Data:', trips);
  } catch (error) {
    console.error('Error loading CSV:', error);
    return;
  }

  const stations = computeStationTraffic(jsonData.data.stations, trips);
  console.log('Station Traffic:', stations);

  const maxTraffic = d3.max(stations, (d) => d.totalTraffic);
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, maxTraffic > 0 ? maxTraffic : 1])
    .range([0, 25]);
  const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  // Append circles to the SVG for each station
let circles = svg
  .selectAll('circle')
  .data(stations, (d) => d.short_name)
  .enter()
  .append('circle')
  .attr('r', (d) => radiusScale(d.totalTraffic)) // Radius scales with station traffic
  .style('--departure-ratio', (d) =>
    stationFlow(d.totalTraffic === 0 ? 0 : d.departures / d.totalTraffic),
  )
  .attr('stroke', 'white') // Circle border color
  .attr('stroke-width', 1) // Circle border thickness
  .attr('opacity', 0.8) // Circle opacity
  .each(function (d) {
    d3.select(this)
      .append('title')
      .text(
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
      );
  });

  // Function to update circle positions when the map moves/zooms
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
      .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsbyTime(trips, timeFilter);
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    circles = circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) =>
        stationFlow(d.totalTraffic === 0 ? 0 : d.departures / d.totalTraffic),
      );

    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy)
      .select('title')
      .text(
        (d) =>
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
      );
  }

  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      selectedTime.style.display = 'none';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      selectedTime.style.display = 'block';
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
