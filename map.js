let map;
let currentData = null;
let currentCity = null;
let geocoder;
let visibleCategories = [];

// Global variables for locations
let allLocations = null;
let locations = { preferred: [], other: [], family: [] };
let locationMarkers = [];

// Add label toggle state
let labelToggles = {
    preferred: false,
    other: false,
    family: false
};

// Default colors for buckets
const defaultColors = [
    '#ff0000',  // Red
    '#ff6600',  // Orange
    '#ffcc00',  // Yellow
    '#339900',  // Green
    '#0066cc',  // Blue
    '#6600cc'   // Purple
];

// Default bucket ranges
const defaultBucketRanges = [
    { min: 1500, max: Infinity, label: '1500+' },
    { min: 1250, max: 1500, label: '1250-1500' },
    { min: 1000, max: 1250, label: '1000-1250' },
    { min: 750, max: 1000, label: '750-1000' },
    { min: 500, max: 750, label: '500-750' },
    { min: 0, max: 500, label: '0-500' }
];

// Initialize the map
function initializeMap() {
    mapboxgl.accessToken = config.accessToken;
    
    map = new mapboxgl.Map({
        container: 'map',
        style: config.style,
        center: config.center,
        zoom: config.zoom
    });

    // Wait for map style to load before customizing
    map.on('style.load', () => {
        // Add custom layers and styling
        if (map.getLayer('water')) {
            map.setPaintProperty('water', 'fill-color', '#b3e0ff');  // Lighter blue water
        }
        
        // Style parks and green areas with more vibrant colors
        const landuseLayers = [
            'landuse-residential',
            'landuse-commercial',
            'landuse-park',
            'landuse-cemetery',
            'landuse-hospital',
            'landuse-school'
        ];

        landuseLayers.forEach(layer => {
            if (map.getLayer(layer)) {
                map.setPaintProperty(layer, 'fill-color', [
                    'match',
                    ['get', 'class'],
                    'park', '#a8e6a8',  // Soft green for parks
                    'cemetery', '#c8e6c8',  // Lighter green for cemeteries
                    'hospital', '#ffd6a5',  // Soft orange for hospitals
                    'school', '#e6c3e6',  // Soft purple for schools
                    'commercial', '#f0f0f0',  // Light gray for commercial areas
                    'residential', '#ffffff',  // White for residential areas
                    '#f8f8f8'  // Default light gray
                ]);
            }
        });

        // Style buildings with a subtle color
        if (map.getLayer('building')) {
            map.setPaintProperty('building', 'fill-color', '#f5f5f5');
            map.setPaintProperty('building', 'fill-opacity', 0.8);
            map.setPaintProperty('building', 'fill-outline-color', '#e0e0e0');
        }

        // Add more contrast to roads
        const roadLayers = [
            'road-primary',
            'road-secondary',
            'road-street',
            'road-minor'
        ];

        roadLayers.forEach(layer => {
            if (map.getLayer(layer)) {
                map.setPaintProperty(layer, 'line-color', '#e3e3e3');
            }
        });

        // Make water labels more visible
        const waterLabels = [
            'water-point-label',
            'water-line-label'
        ];

        waterLabels.forEach(layer => {
            if (map.getLayer(layer)) {
                map.setPaintProperty(layer, 'text-color', '#4a90e2');
            }
        });

        // Load location points after style is loaded
        loadLocationPoints();
    });
    
    // Add navigation controls
    map.addControl(new mapboxgl.NavigationControl());
    
    // Add geocoder (address search)
    geocoder = new MapboxGeocoder({
        accessToken: mapboxgl.accessToken,
        mapboxgl: mapboxgl,
        marker: {
            color: '#0066FF'
        },
        placeholder: 'Search for an address'
    });
    document.getElementById('geocoder').appendChild(geocoder.onAdd(map));
    
    // Initialize the interface after map loads
    map.on('load', () => {
        populateCityDropdown();
        setupEventListeners();
        validateAndApplyFilters();
    });
}

function populateCityDropdown() {
    const citySelector = document.getElementById('city-selector');
    
    // Clear any existing options
    citySelector.innerHTML = '';

    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.textContent = "Select a city";
    citySelector.appendChild(defaultOption);

    // Add sorted city options
    const sortedCities = [...config.polygonLayers]
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    sortedCities.forEach(layer => {
        const option = document.createElement('option');
        option.value = layer.name;
        option.textContent = layer.name;
        citySelector.appendChild(option);
    });

    // Add change event listener
    citySelector.addEventListener('change', (e) => {
        const selectedCity = e.target.value;
        if (selectedCity) {
            loadCity(selectedCity);
        } else {
            clearMapData();
        }
        // Update URL parameters when city changes
        updateUrlParameters();
    });
    
    // Check for city in URL parameters
    const params = getUrlParameters();
    if (params.city) {
        citySelector.value = params.city;
        if (citySelector.value === params.city) { // Only load if it's a valid city
            loadCity(params.city);
        }
    }
}

// Function to get URL parameters
function getUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    return {
        city: params.get('city')
    };
}

// Function to update URL parameters
function updateUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    
    if (currentCity) {
        params.set('city', currentCity);
    } else {
        params.delete('city');
    }
    
    // Update URL without reloading the page
    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.pushState({}, '', newUrl);
}

// Load the list of available cities
function loadCityList() {
    // Helper function to format city name
    function formatCityName(name) {
        // Remove any file extensions
        name = name.replace(/\.[^/.]+$/, "");
        // Replace underscores and %20 with spaces
        name = name.replace(/[_\%20]/g, " ");
        // If it contains "Demographics", take only what's before it
        if (name.includes("Demographics")) {
            name = name.split("Demographics")[0];
        }
        // Trim any trailing spaces or special characters
        name = name.trim();
        // Ensure proper capitalization
        return name.split(" ")
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(" ");
    }

    try {
        // Initialize the city selector
        const initializeSelector = () => {
            const citySelector = document.getElementById('city-selector');
            citySelector.innerHTML = '<option value="">Select a city</option>';
            
            // Create a map of city layers for quick lookup
            const cityLayersMap = {};
            config.polygonLayers.forEach(layer => {
                cityLayersMap[layer.name] = layer;
            });
            
            // Add cities in the order specified in filters
            config.filters[0].listItems.forEach(cityName => {
                if (cityLayersMap[cityName]) {
                    const option = document.createElement('option');
                    option.value = cityName;
                    option.textContent = cityName;
                    citySelector.appendChild(option);
                }
            });

            // Add event listener for city selection
            citySelector.addEventListener('change', (e) => {
                const selectedCity = e.target.value;
                if (selectedCity) {
                    currentCity = selectedCity;
                    loadCity(selectedCity);
                }
            });
        };

        // Start initialization
        initializeSelector();

    } catch (error) {
        console.error('Error loading city list:', error);
        // Fallback to config cities if directory listing fails
        const formattedCities = {};
        config.polygonLayers.forEach(layer => {
            const formattedName = formatCityName(layer.name);
            formattedCities[formattedName] = layer;
        });
        config.polygonLayers = formattedCities;
    }
}

// Load KML data for a specific city
async function loadCity(cityName) {
    try {
        // Clear existing data
        clearMapData();
        currentCity = cityName;

        // Find the selected city configuration
        const cityConfig = config.polygonLayers.find(layer => layer.name === cityName);
        if (!cityConfig) {
            console.error('City configuration not found:', cityName);
            return;
        }

        // Load and process the KML file
        const geoJSON = await loadKMLFile(cityConfig.file);
        if (!geoJSON) {
            console.error('Failed to load KML file');
            return;
        }

        // Calculate and display stats
        updateCityStats(geoJSON);

        // Add the GeoJSON as a source
        if (map.getSource('demographics')) {
            map.getSource('demographics').setData(geoJSON);
        } else {
            map.addSource('demographics', {
                type: 'geojson',
                data: geoJSON
            });

            // Add a new layer for the demographics data
            map.addLayer({
                id: 'demographics',
                type: 'fill',
                source: 'demographics',
                paint: {
                    'fill-color': 'rgba(0, 0, 0, 0)',
                    'fill-outline-color': 'rgba(0, 0, 0, 0)'
                }
            });
        }

        // Update the current data
        currentData = geoJSON;

        // Fit the map to the bounds of the new data
        const bounds = new mapboxgl.LngLatBounds();
        geoJSON.features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates) {
                // Handle both Polygon and MultiPolygon
                if (feature.geometry.type === 'Polygon') {
                    feature.geometry.coordinates[0].forEach(coord => {
                        bounds.extend(coord);
                    });
                } else if (feature.geometry.type === 'MultiPolygon') {
                    feature.geometry.coordinates.forEach(polygon => {
                        polygon[0].forEach(coord => {
                            bounds.extend(coord);
                        });
                    });
                }
            }
        });
        
        // Only fit bounds if we have valid coordinates
        if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { 
                padding: 50,
                maxZoom: 13  // Prevent zooming in too close
            });
        }

        // Apply filters immediately after loading
        validateAndApplyFilters();

    } catch (error) {
        console.error('Error loading city:', error);
    }
}

// Load KML file
async function loadKMLFile(kmlFile) {
    try {
        const response = await fetch(kmlFile);
        const kmlText = await response.text();
        const parser = new DOMParser();
        const kml = parser.parseFromString(kmlText, 'text/xml');
        const placemarks = kml.getElementsByTagName('Placemark');
        
        const features = [];
        
        for (let i = 0; i < placemarks.length; i++) {
            const placemark = placemarks[i];
            const feature = processPlacemark(placemark);
            if (feature) {
                features.push(feature);
            }
        }

        return {
            type: 'FeatureCollection',
            features: features
        };
    } catch (error) {
        console.error('Error loading KML file:', error);
        return null;
    }
}

// Function to process a single placemark
function processPlacemark(placemark) {
    try {
        const styleUrl = placemark.getElementsByTagName('styleUrl')[0]?.textContent;
        const style = styleUrl ? parseInt(styleUrl.replace('#style_', '')) : null;
        const counts = extractKidsCount(placemark);
        const coordinates = placemark.getElementsByTagName('coordinates')[0]?.textContent?.trim();
        
        if (!coordinates) return null;
        
        // Split the coordinates string and convert to number pairs
        const coords = coordinates.split(' ')
            .filter(coord => coord.trim())
            .map(coord => {
                const [lng, lat] = coord.split(',').map(Number);
                return [lng, lat];
            });
            
        // Ensure the polygon is closed
        if (coords.length > 0 && (coords[0][0] !== coords[coords.length - 1][0] || 
                                coords[0][1] !== coords[coords.length - 1][1])) {
            coords.push(coords[0]);
        }
        
        return {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [coords]
            },
            properties: {
                style: style,
                kids_250k: counts.kids_250k || 0,
                kids_500k: counts.kids_500k || 0
            }
        };
    } catch (error) {
        console.error('Error processing placemark:', error);
        return null;
    }
}

// Function to extract kids count from KML placemark
function extractKidsCount(placemark) {
    const counts = {};
    
    // Try to get count from description element first
    const descElement = placemark.getElementsByTagName('description')[0];
    if (descElement) {
        const desc = descElement.textContent;
        if (desc.includes('Kids')) {
            // Extract the number from descriptions like "1500+ Kids" or "<500 Kids"
            const match = desc.match(/([<>]?\d+)[\+]?\s*Kids/);
            if (match) {
                const value = match[1];
                if (value.startsWith('<')) {
                    counts.kids_250k = parseInt(value.substring(1));
                    counts.kids_500k = parseInt(value.substring(1));
                } else {
                    counts.kids_250k = parseInt(value);
                    counts.kids_500k = parseInt(value);
                }
            }
        }
    }
    
    // Fallback to data elements if no description found
    if (!counts.kids_250k && !counts.kids_500k) {
        const dataElements = placemark.getElementsByTagName('data');
        for (let i = 0; i < dataElements.length; i++) {
            const dataElement = dataElements[i];
            const name = dataElement.getAttribute('name');
            const value = parseInt(dataElement.textContent);
            
            if (name === 'kids_250k') counts.kids_250k = value;
            if (name === 'kids_500k') counts.kids_500k = value;
        }
    }
    
    return counts;
}

function updateVisibleCategories() {
    // Get all checked categories
    const visible250k = [];
    const visible500k = [];
    
    document.querySelectorAll('.category-checkbox:checked').forEach(checkbox => {
        const category = checkbox.value;
        const income = checkbox.getAttribute('data-income');
        if (income === '500k') {
            visible500k.push(category);
        } else {
            visible250k.push(category);
        }
    });

    console.log('Visible categories:', {
        '250k': visible250k,
        '500k': visible500k
    });

    // Update main layer
    if (map.getLayer('demographics')) {
        // Update fill color and opacity
        const colorExpression = [
            'match',
            ['get', 'style'],
            0, '#ff0000',  // Red
            1, '#ff6600',  // Orange
            2, '#ffcc00',  // Yellow
            3, '#339900',  // Green
            4, '#0066cc',  // Blue
            '#ff0000'      // Default red
        ];

        map.setPaintProperty('demographics', 'fill-color', colorExpression);
    }
}

function validateAndApplyFilters() {
    // Get parent checkboxes
    const parent250k = document.querySelector('#income250k-parent');
    const parent500k = document.querySelector('#income500k-parent');

    // Build filters for both income levels
    const filters = {
        income250k: [],
        income500k: []
    };

    // Only collect 250k filters if parent is checked
    if (parent250k && parent250k.checked) {
        const categories = document.querySelectorAll('#income250k-categories .category-item');
        categories.forEach(category => {
            const checkbox = category.querySelector('.category-checkbox');
            if (checkbox && checkbox.checked) {
                const colorBox = category.querySelector('.color-box');
                const minInput = category.querySelector('.range-min');
                const maxInput = category.querySelector('.range-max');
                
                if (colorBox) {
                    filters.income250k.push({
                        min: parseInt(minInput?.value) || 0,
                        max: maxInput?.value ? parseInt(maxInput.value) : 999999,
                        color: colorBox.style.backgroundColor
                    });
                }
            }
        });
    }

    // Only collect 500k filters if parent is checked
    if (parent500k && parent500k.checked) {
        const categories = document.querySelectorAll('#income500k-categories .category-item');
        categories.forEach(category => {
            const checkbox = category.querySelector('.category-checkbox');
            if (checkbox && checkbox.checked) {
                const colorBox = category.querySelector('.color-box');
                const minInput = category.querySelector('.range-min');
                const maxInput = category.querySelector('.range-max');
                
                if (colorBox) {
                    filters.income500k.push({
                        min: parseInt(minInput?.value) || 0,
                        max: maxInput?.value ? parseInt(maxInput.value) : 999999,
                        color: colorBox.style.backgroundColor
                    });
                }
            }
        });
    }

    console.log('Collected filters:', filters);
    applyFiltersToMap(filters);
}

function applyFiltersToMap(filters) {
    if (!map.getSource('demographics')) {
        console.warn('No demographic data loaded');
        return;
    }

    // Build color expression
    const conditions = [];
    
    // Add 500k filters first (higher priority)
    filters.income500k.forEach(f => {
        conditions.push([
            'all',
            ['has', 'kids_500k'],
            ['>', ['to-number', ['get', 'kids_500k']], 0],
            ['>=', ['to-number', ['get', 'kids_500k']], f.min],
            ['<=', ['to-number', ['get', 'kids_500k']], f.max]
        ]);
        conditions.push(f.color);
    });

    // Add 250k filters second (lower priority)
    filters.income250k.forEach(f => {
        conditions.push([
            'all',
            ['has', 'kids_250k'],
            ['>', ['to-number', ['get', 'kids_250k']], 0],
            ['>=', ['to-number', ['get', 'kids_250k']], f.min],
            ['<=', ['to-number', ['get', 'kids_250k']], f.max]
        ]);
        conditions.push(f.color);
    });

    // Create the final expression
    const colorExpr = conditions.length > 0 
        ? ['case', ...conditions, 'rgba(0, 0, 0, 0)']
        : ['literal', 'rgba(0, 0, 0, 0)'];

    console.log('Color expression:', JSON.stringify(colorExpr, null, 2));
    console.log('Active filters:', {
        '500k': filters.income500k.length,
        '250k': filters.income250k.length
    });

    // Update the layer's paint properties
    map.setPaintProperty('demographics', 'fill-color', colorExpr);
}

function resetBucketValues() {
    const bucketRows = document.querySelectorAll('.bucket-row');
    
    bucketRows.forEach((row, index) => {
        const minInput = row.querySelector('.range-min');
        const maxInput = row.querySelector('.range-max');
        
        if (minInput && maxInput) {
            minInput.value = defaultBucketRanges[index].min;
            if (defaultBucketRanges[index].max === Infinity) {
                maxInput.value = '';
                maxInput.placeholder = 'No limit';
            } else {
                maxInput.value = defaultBucketRanges[index].max;
            }
        }
    });
    
    // Update filters and apply changes
    updateFilterRanges();
    validateAndApplyFilters();
}

function setupEventListeners() {
    // Add collapse button listener
    const collapseBtn = document.getElementById('collapse-btn');
    const sidebar = document.querySelector('.sidebar');
    
    collapseBtn.addEventListener('click', function() {
        const willCollapse = !sidebar.classList.contains('collapsed');
        sidebar.classList.toggle('collapsed');
        this.innerHTML = willCollapse ? '<' : 'X';
        
        // Force map resize after transition
        setTimeout(() => {
            map.resize();
        }, 300);
    });

    // Store checkbox states for each income group
    const checkboxStates = new Map();

    // Handle edit buckets button
    const editBucketsBtn = document.getElementById('edit-buckets-btn');
    const editBucketsForm = document.getElementById('edit-buckets-form');
    const applyBucketsBtn = document.getElementById('apply-buckets');
    const cancelBucketsBtn = document.getElementById('cancel-buckets');
    const resetBucketsBtn = document.getElementById('reset-buckets');

    editBucketsBtn.addEventListener('click', () => {
        editBucketsForm.classList.remove('hidden');
    });

    cancelBucketsBtn.addEventListener('click', () => {
        editBucketsForm.classList.add('hidden');
    });

    // Add reset button event listener
    resetBucketsBtn.addEventListener('click', resetBucketValues);

    // Handle bucket range inputs
    const bucketRows = document.querySelectorAll('.bucket-row');
    bucketRows.forEach((row, index) => {
        const minInput = row.querySelector('.range-min');
        const maxInput = row.querySelector('.range-max');

        if (minInput) {
            minInput.addEventListener('change', () => {
                const value = parseInt(minInput.value) || 0;
                // Adjust bucket below's max if it exists
                if (index < bucketRows.length - 1) {
                    const nextRow = bucketRows[index + 1];
                    const nextMax = nextRow.querySelector('.range-max');
                    if (nextMax && !nextMax.disabled) {
                        nextMax.value = value - 1;
                    }
                }
                validateBucketRanges();
            });
        }

        if (maxInput && !maxInput.disabled) {
            maxInput.addEventListener('change', () => {
                const value = parseInt(maxInput.value) || 0;
                // Adjust bucket above's min if it exists
                if (index > 0) {
                    const prevRow = bucketRows[index - 1];
                    const prevMin = prevRow.querySelector('.range-min');
                    if (prevMin) {
                        prevMin.value = value + 1;
                    }
                }
                validateBucketRanges();
            });
        }
    });

    // Handle apply buckets button
    applyBucketsBtn.addEventListener('click', () => {
        if (validateBucketRanges()) {
            updateFilterRanges();
            editBucketsForm.classList.add('hidden');
            validateAndApplyFilters();
        }
    });

    // Initialize parent checkboxes and child states
    document.querySelectorAll('.parent-checkbox').forEach(parentCheckbox => {
        const incomeGroup = parentCheckbox.closest('.income-group');
        const groupId = incomeGroup.id;
        
        if (!checkboxStates.has(groupId)) {
            checkboxStates.set(groupId, new Map());
        }

        const childCheckboxes = incomeGroup.querySelectorAll('.category-checkbox');
        childCheckboxes.forEach(childCheckbox => {
            childCheckbox.disabled = !parentCheckbox.checked;
            checkboxStates.get(groupId).set(childCheckbox.id, childCheckbox.checked);
        });
    });

    // Handle parent checkbox clicks
    document.querySelectorAll('.parent-checkbox').forEach(parentCheckbox => {
        parentCheckbox.addEventListener('change', function() {
            const incomeGroup = this.closest('.income-group');
            const childCheckboxes = incomeGroup.querySelectorAll('.category-checkbox');

            childCheckboxes.forEach(childCheckbox => {
                childCheckbox.disabled = !this.checked;
            });
            
            // Always validate and apply filters
            validateAndApplyFilters();
        });
    });

    // Handle child checkbox changes
    document.querySelectorAll('.category-checkbox').forEach(childCheckbox => {
        childCheckbox.addEventListener('change', validateAndApplyFilters);
    });

    // Handle category header clicks for collapse/expand
    document.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', function(e) {
            // Don't toggle if clicking checkbox
            if (e.target.matches('.category-checkbox')) {
                return;
            }
            const rangeInputs = this.closest('.category-item').querySelector('.range-inputs');
            rangeInputs.classList.toggle('hidden');
        });
    });

    // Close range inputs when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.category-header') && !e.target.closest('.range-inputs')) {
            document.querySelectorAll('.range-inputs:not(.hidden)').forEach(input => {
                input.classList.add('hidden');
            });
        }
    });

    // Handle income header clicks for collapse/expand all in group
    document.querySelectorAll('.income-header').forEach(header => {
        header.addEventListener('click', function(e) {
            // Don't toggle if clicking checkbox
            if (e.target.matches('.parent-checkbox')) {
                return;
            }
            const group = this.closest('.income-group');
            const rangeInputs = group.querySelectorAll('.range-inputs');
            const allHidden = Array.from(rangeInputs).every(input => input.classList.contains('hidden'));
            
            rangeInputs.forEach(input => {
                input.classList.toggle('hidden', !allHidden);
            });
        });
    });

    // Handle range input changes
    document.querySelectorAll('.range-inputs input').forEach(input => {
        input.addEventListener('change', validateAndApplyFilters);
    });

    // Handle form submission
    document.getElementById('filter-form').addEventListener('submit', function(e) {
        e.preventDefault();
        validateAndApplyFilters();
    });

    // Add location filter listeners
    document.getElementById('preferred-locations').addEventListener('change', updateMarkerVisibility);
    document.getElementById('other-locations').addEventListener('change', updateMarkerVisibility);
    document.getElementById('family-locations').addEventListener('change', updateMarkerVisibility);

    // Add label toggle functionality
    document.getElementById('preferred-labels-toggle').addEventListener('click', function() {
        labelToggles.preferred = !labelToggles.preferred;
        this.textContent = labelToggles.preferred ? 'Labels On' : 'Labels Off';
        this.classList.toggle('active');
        updateLabelVisibility();
    });

    document.getElementById('other-labels-toggle').addEventListener('click', function() {
        labelToggles.other = !labelToggles.other;
        this.textContent = labelToggles.other ? 'Labels On' : 'Labels Off';
        this.classList.toggle('active');
        updateLabelVisibility();
    });

    document.getElementById('family-labels-toggle').addEventListener('click', function() {
        labelToggles.family = !labelToggles.family;
        this.textContent = labelToggles.family ? 'Labels On' : 'Labels Off';
        this.classList.toggle('active');
        updateLabelVisibility();
    });
}

function updateFilterRanges() {
    const bucketRows = document.querySelectorAll('.bucket-row');
    const ranges = [];

    bucketRows.forEach((row, index) => {
        const minInput = row.querySelector('.range-min');
        const maxInput = row.querySelector('.range-max');
        
        if (minInput && maxInput) {
            ranges.push({
                min: parseInt(minInput.value) || 0,
                max: maxInput.disabled ? Infinity : (parseInt(maxInput.value) || 0),
                label: `${minInput.value}${maxInput.disabled ? '+' : '-' + maxInput.value}`
            });
        }
    });

    // Update both 250k and 500k filter ranges
    ['income250k-categories', 'income500k-categories'].forEach(categoryId => {
        const categoryItems = document.querySelectorAll(`#${categoryId} .category-item`);
        
        categoryItems.forEach((category, index) => {
            if (index < ranges.length) {
                const rangeInputs = category.querySelector('.range-inputs');
                if (!rangeInputs) return;

                const minInput = rangeInputs.querySelector('.range-min');
                const maxInput = rangeInputs.querySelector('.range-max');
                const label = category.querySelector('.category-label');
                
                if (minInput) minInput.value = ranges[index].min;
                if (maxInput) {
                    if (index === 0) {
                        maxInput.value = '';
                        maxInput.placeholder = 'No limit';
                    } else {
                        maxInput.value = ranges[index].max;
                    }
                }
                if (label) {
                    label.textContent = `${ranges[index].label} Kids`;
                }
            }
        });
    });

    // Trigger filter update
    validateAndApplyFilters();
}

function validateBucketRanges() {
    const bucketRows = Array.from(document.querySelectorAll('.bucket-row'));
    let isValid = true;

    // Validate each bucket against the next bucket
    for (let i = 0; i < bucketRows.length - 1; i++) {
        const currentMinInput = bucketRows[i].querySelector('.range-min');
        const currentMaxInput = bucketRows[i].querySelector('.range-max');
        const nextMinInput = bucketRows[i + 1].querySelector('.range-min');
        const nextMaxInput = bucketRows[i + 1].querySelector('.range-max');
        
        if (!currentMinInput || !nextMaxInput) continue;

        const currentMin = parseInt(currentMinInput.value) || 0;
        const nextMax = parseInt(nextMaxInput.value) || 0;

        // Current bucket's min should be greater than next bucket's max
        if (currentMin <= nextMax) {
            currentMinInput.setCustomValidity(`Minimum must be greater than the next bucket's maximum (${nextMax})`);
            isValid = false;
        } else {
            currentMinInput.setCustomValidity('');
        }

        // Also validate that min is less than max within the same bucket
        if (!currentMaxInput.disabled) {
            const currentMax = parseInt(currentMaxInput.value) || 0;
            if (currentMin >= currentMax) {
                currentMinInput.setCustomValidity('Min must be less than max');
                isValid = false;
            }
        }

        currentMinInput.reportValidity();
    }

    // Validate the last bucket separately (just min < max)
    const lastBucket = bucketRows[bucketRows.length - 1];
    const lastMinInput = lastBucket.querySelector('.range-min');
    const lastMaxInput = lastBucket.querySelector('.range-max');
    
    if (lastMinInput && lastMaxInput && !lastMaxInput.disabled) {
        const lastMin = parseInt(lastMinInput.value) || 0;
        const lastMax = parseInt(lastMaxInput.value) || 0;
        
        if (lastMin >= lastMax) {
            lastMinInput.setCustomValidity('Min must be less than max');
            isValid = false;
        } else {
            lastMinInput.setCustomValidity('');
        }
        lastMinInput.reportValidity();
    }

    return isValid;
}

function clearMapData() {
    // Clear the demographics data
    if (map.getSource('demographics')) {
        map.getSource('demographics').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    // Hide the stats container
    document.querySelector('.stats-container').classList.add('hidden');

    currentData = null;
    currentCity = null;
}

function updateCityStats(geoJSON) {
    const statsContainer = document.querySelector('.stats-container');
    
    // Show the stats container
    statsContainer.classList.remove('hidden');

    // Initialize min/max values
    let stats = {
        kids_250k: { min: Infinity, max: -Infinity },
        kids_500k: { min: Infinity, max: -Infinity }
    };

    // Calculate min/max for both properties
    geoJSON.features.forEach(feature => {
        const props = feature.properties;
        
        // Process kids_250k
        if (props.kids_250k !== undefined) {
            const value = parseInt(props.kids_250k) || 0;
            stats.kids_250k.min = Math.min(stats.kids_250k.min, value);
            stats.kids_250k.max = Math.max(stats.kids_250k.max, value);
        }
        
        // Process kids_500k
        if (props.kids_500k !== undefined) {
            const value = parseInt(props.kids_500k) || 0;
            stats.kids_500k.min = Math.min(stats.kids_500k.min, value);
            stats.kids_500k.max = Math.max(stats.kids_500k.max, value);
        }
    });

    // Update the table with calculated values
    document.getElementById('kids250k-min').textContent = stats.kids_250k.min === Infinity ? '-' : stats.kids_250k.min;
    document.getElementById('kids250k-max').textContent = stats.kids_250k.max === -Infinity ? '-' : stats.kids_250k.max;
    document.getElementById('kids500k-min').textContent = stats.kids_500k.min === Infinity ? '-' : stats.kids_500k.min;
    document.getElementById('kids500k-max').textContent = stats.kids_500k.max === -Infinity ? '-' : stats.kids_500k.max;
}

// Load location points from KML files
async function loadLocationPoints() {
    try {
        // Clear existing markers
        locationMarkers.forEach(marker => marker.remove());
        locationMarkers = [];
        
        // Reset locations
        locations = {
            preferred: [],
            other: [],
            family: []
        };

        // Wait for map style to load
        if (!map.isStyleLoaded()) {
            await new Promise(resolve => map.once('style.load', resolve));
        }

        // Load KML files
        const preferredKml = await fetch('data/preferred_locations.kml').then(res => res.text()).then(text => new DOMParser().parseFromString(text, 'text/xml'));
        const otherKml = await fetch('data/other_locations.kml').then(res => res.text()).then(text => new DOMParser().parseFromString(text, 'text/xml'));
        const familyKml = await fetch('data/family_locations.kml').then(res => res.text()).then(text => new DOMParser().parseFromString(text, 'text/xml'));

        // Process locations
        processLocations(preferredKml, 'preferred', '#FF0000');
        processLocations(otherKml, 'other', '#0000FF');
        processLocations(familyKml, 'family', '#00FF00');

        // Update visibility
        updateMarkerVisibility();
        
    } catch (error) {
        console.error('Error loading location points:', error);
    }
}

function processLocations(kml, type, color) {
    const placemarks = kml.getElementsByTagName('Placemark');
    Array.from(placemarks).forEach(placemark => {
        const pointElem = placemark.getElementsByTagName('Point')[0];
        if (!pointElem) return;
        
        const coordsElem = pointElem.getElementsByTagName('coordinates')[0];
        if (!coordsElem) return;
        
        const coords = coordsElem.textContent.trim().split(',');
        if (coords.length < 2) return;

        // Get name and description
        const nameElem = placemark.getElementsByTagName('name')[0] || placemark.getElementsByTagName('n')[0];
        const name = nameElem ? nameElem.textContent.trim() : '';
        const descElem = placemark.getElementsByTagName('description')[0];
        const description = descElem ? descElem.textContent : '';

        // Create marker element
        const el = document.createElement('div');
        el.className = `location-marker ${type}`;

        // Always add label if name exists, but initially hidden
        if (name) {
            const label = document.createElement('div');
            label.className = 'marker-label';
            label.textContent = name;
            el.appendChild(label);
        }

        // Create marker
        const marker = new mapboxgl.Marker({
            element: el,
            color: color
        })
        .setLngLat([parseFloat(coords[0]), parseFloat(coords[1])]);

        // Add popup
        if (description) {
            const popup = new mapboxgl.Popup({
                offset: 25,
                maxWidth: '300px'
            })
            .setHTML(description);
            marker.setPopup(popup);
        }

        // Add to map and store
        marker.addTo(map);
        locations[type].push({
            longitude: parseFloat(coords[0]),
            latitude: parseFloat(coords[1]),
            name,
            description
        });
        locationMarkers.push(marker);

        // Hide non-preferred markers by default
        if (type !== 'preferred') {
            marker.getElement().style.display = 'none';
        }
    });
}

function updateMarkerVisibility() {
    const preferredVisible = document.getElementById('preferred-locations').checked;
    const otherVisible = document.getElementById('other-locations').checked;
    const familyVisible = document.getElementById('family-locations').checked;

    let currentIndex = 0;
    
    // Update preferred markers
    locations.preferred.forEach(() => {
        locationMarkers[currentIndex].getElement().style.display = preferredVisible ? 'block' : 'none';
        currentIndex++;
    });

    // Update other markers
    locations.other.forEach(() => {
        locationMarkers[currentIndex].getElement().style.display = otherVisible ? 'block' : 'none';
        currentIndex++;
    });

    // Update family markers
    locations.family.forEach(() => {
        locationMarkers[currentIndex].getElement().style.display = familyVisible ? 'block' : 'none';
        currentIndex++;
    });
}

function updateLabelVisibility() {
    let currentIndex = 0;
    
    // Update preferred markers
    locations.preferred.forEach(() => {
        const markerEl = locationMarkers[currentIndex].getElement();
        const label = markerEl.querySelector('.marker-label');
        if (label) {
            label.classList.toggle('visible', labelToggles.preferred);
        }
        currentIndex++;
    });

    // Update other markers
    locations.other.forEach(() => {
        const markerEl = locationMarkers[currentIndex].getElement();
        const label = markerEl.querySelector('.marker-label');
        if (label) {
            label.classList.toggle('visible', labelToggles.other);
        }
        currentIndex++;
    });

    // Update family markers
    locations.family.forEach(() => {
        const markerEl = locationMarkers[currentIndex].getElement();
        const label = markerEl.querySelector('.marker-label');
        if (label) {
            label.classList.toggle('visible', labelToggles.family);
        }
        currentIndex++;
    });
}

// Initialize the map when the page loads
initializeMap();
