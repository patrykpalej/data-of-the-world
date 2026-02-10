// Global state
const state = {
    indexes: [],
    countries: [],
    countryMap: {}, // Map of country_code -> { name, flag, label }
    continentMap: {}, // Map of country_code -> continent
    yearRange: { min_year: null, max_year: null },
    plotYearRanges: {},
    currentTheme: localStorage.getItem('theme') || 'dark',
    // Cache for locked axis ranges (keyed by "plotNum-xAxis-yAxis")
    lockedAxisRanges: {},
    // Current zoom state per plot (keyed by plotNum)
    zoomState: {},
    // Hidden continents per plot (keyed by plotNum)
    hiddenContinents: {},
    // Track whether the second plot has been initialized (desktop only)
    secondPlotInitialized: false
};

// Static English UI text
const uiText = {
    'title': 'World Statistics Dashboard',
    'tab-compare': 'Compare',
    'tab-timeline': 'Timeline',
    'tab-map': 'Map',
    'tab-raw-data': 'Raw Data',
    'x-axis': 'X Axis:',
    'y-axis': 'Y Axis:',
    'year': 'Year:',
    'select-year': 'Select year',
    'all-years': 'All years data',
    'all-years-averaged': 'All years averaged',
    'color-by-continent': 'Color by continent',
    'lock-axis-range': 'Lock axis range',
    'reset-zoom': 'Reset Zoom',
    'coming-soon': 'Coming soon...',
    'data-source': 'Data source: World Bank, UNDP, OECD, and other international organizations',
    'disclaimer': 'Disclaimer: This data is provided for informational purposes only',
    'raw-data-year': 'Year:',
    'raw-data-continent': 'Continent:',
    'raw-data-country': 'Country:',
    'raw-data-all-continents': 'All continents',
    'raw-data-all-countries': 'All countries',
    'raw-data-country-code': 'Code',
    'raw-data-country-name': 'Country',
    'raw-data-continent-col': 'Continent',
    'raw-data-indexes': 'Indicators:',
    'raw-data-all-indexes': 'All indicators',
    'raw-data-no-data': 'No data available for selected filters',
    'raw-data-loading': 'Loading data...',
    'select-all': 'Select all',
    'unselect-all': 'Unselect all'
};

const t = (key) => uiText[key] || key;

function buildCountryLabel(name, flag) {
    const cleanName = (name || '').trim();
    const cleanFlag = (flag || '').trim();
    return cleanFlag ? `${cleanFlag} ${cleanName}`.trim() : cleanName;
}

function getCountryLabel(countryCode) {
    const entry = state.countryMap[countryCode];
    if (!entry) return countryCode;
    return entry.label || entry.name || countryCode;
}

function isSecondPlotEnabled() {
    return window.matchMedia('(min-width: 1201px)').matches;
}

function isSecondPlotActive() {
    return isSecondPlotEnabled() && state.secondPlotInitialized;
}

async function ensureSecondPlotInitialized() {
    if (!isSecondPlotEnabled() || state.secondPlotInitialized) return;
    await initializePlot(2);
}

// Format large numbers for axis ticks (e.g., 1000000 -> "1M")
function formatAxisTick(value) {
    const absValue = Math.abs(value);

    if (absValue === 0) return '0';

    // For very small numbers, use scientific notation
    if (absValue < 0.001 && absValue !== 0) {
        return value.toExponential(1);
    }

    // For numbers between 0.001 and 1, show up to 3 decimal places
    if (absValue < 1) {
        return value.toFixed(3).replace(/\.?0+$/, '');
    }

    // For numbers >= 1 billion
    if (absValue >= 1e9) {
        const formatted = (value / 1e9);
        return formatted.toFixed(formatted % 1 === 0 ? 0 : 1) + 'B';
    }

    // For numbers >= 1 million
    if (absValue >= 1e6) {
        const formatted = (value / 1e6);
        return formatted.toFixed(formatted % 1 === 0 ? 0 : 1) + 'M';
    }

    // For numbers >= 1 thousand
    if (absValue >= 1e3) {
        const formatted = (value / 1e3);
        return formatted.toFixed(formatted % 1 === 0 ? 0 : 1) + 'K';
    }

    // For regular numbers, limit decimal places
    if (absValue >= 100) {
        return Math.round(value).toString();
    }

    if (absValue >= 10) {
        return value.toFixed(1).replace(/\.0$/, '');
    }

    return value.toFixed(2).replace(/\.?0+$/, '');
}

// Format numbers for tooltips (more readable with locale formatting)
function formatTooltipValue(value) {
    const absValue = Math.abs(value);

    if (absValue === 0) return '0';

    // For very small numbers
    if (absValue < 0.001 && absValue !== 0) {
        return value.toExponential(2);
    }

    // For small decimals
    if (absValue < 1) {
        return value.toFixed(4).replace(/\.?0+$/, '');
    }

    // For large numbers, use locale formatting with abbreviation
    if (absValue >= 1e9) {
        return (value / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 }) + 'B';
    }
    if (absValue >= 1e6) {
        return (value / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) + 'M';
    }
    if (absValue >= 1e3) {
        return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }

    // Regular numbers
    if (absValue >= 100) {
        return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }

    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Hide app loader when initialization is complete
function hideAppLoader() {
    const loader = document.getElementById('appLoader');
    if (loader) {
        loader.classList.add('app-loader--hidden');
        // Remove from DOM after transition completes
        loader.addEventListener('transitionend', () => {
            loader.remove();
        }, { once: true });
    }
}

// Restore saved tab immediately (before content is visible)
function restoreTabEarly() {
    let savedTab = localStorage.getItem('activeTab');
    // Handle legacy tab names
    if (savedTab === 'overview') savedTab = 'compare';
    if (savedTab === 'countries') savedTab = 'timeline';

    if (savedTab && document.getElementById(savedTab)) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === savedTab);
        });
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === savedTab);
        });
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Initializing app...');

    // Apply saved theme immediately
    document.body.className = state.currentTheme + '-mode';
    console.log('Applied theme:', state.currentTheme);

    // Restore saved tab FIRST to prevent tab flicker
    restoreTabEarly();

    // Initialize controls first (before loading data)
    initializeHamburgerMenu();
    initializeTabs();
    initializeThemeToggle();
    initializeDownloadButton();

    // Update UI with saved preferences
    updateThemeIcon();

    // Load data
    await loadIndexes();

    // Load initial global year range
    const globalYearRange = await loadYearRange();
    if (globalYearRange) {
        state.yearRange = globalYearRange;
        updateCompareYearSlider();
    }

    // Shared year controls (used by both plots)
    initializeCompareYearControls();

    await loadCountries();

    // Initialize plots in parallel (will update year ranges based on default selections)
    // Wait for both plots to complete before hiding the loader so they appear simultaneously
    const plotPromises = [initializePlot(1)];
    if (isSecondPlotEnabled()) {
        plotPromises.push(ensureSecondPlotInitialized());
    }
    await Promise.all(plotPromises);

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (isSecondPlotEnabled()) {
                ensureSecondPlotInitialized();
                if (isSecondPlotActive()) {
                    updatePlot(2);
                }
            }
        }, 150);
    });

    // Initialize tab-specific content for the active tab
    // (Compare tab plots are already initialized by initializePlot calls above)
    let activeTab = localStorage.getItem('activeTab');
    // Handle legacy tab names
    if (activeTab === 'overview') activeTab = 'compare';
    if (activeTab === 'countries') activeTab = 'timeline';
    activeTab = activeTab || 'compare';

    if (activeTab === 'raw-data') {
        await initializeRawDataTab();
    } else if (activeTab === 'map') {
        await initializeMapTab();
    } else if (activeTab === 'timeline') {
        await initializeTimelineTab();
    }

    // Hide the loader now that everything is ready
    hideAppLoader();

    console.log('App initialized successfully');
});

// Load indexes from API
async function loadIndexes() {
    try {
        const response = await fetch('/api/indexes');
        const indexes = await response.json();

        // Normalize to objects with id, label, unit, decimals, format, category, and tooltip fields
        const normalized = indexes.map(idx => ({
            id: idx.id,
            label: idx.label,
            unit: idx.unit || '',
            decimals: typeof idx.decimals === 'number' ? idx.decimals : 2,
            format: idx.format || 'number',
            category: idx.category || 'Other',
            // Additional fields for axis label tooltips
            description: idx.description || '',
            source: idx.source || '',
            sourceUrl: idx.sourceUrl || '',
            scale: idx.scale || null
        }));

        state.indexes = normalized;
        indexColumns = normalized.map(idx => ({
            id: idx.id,
            decimals: idx.decimals,
            format: idx.format,
            category: idx.category || 'Other'
        }));

        // Default select-all for raw data indexes depends on this list
        rawDataState.selectedIndexes = new Set(indexColumns.map(c => c.id));

        console.log('Indexes loaded:', state.indexes.length);
        populateAxisSelectors();
    } catch (error) {
        console.error('Error loading indexes:', error);
    }
}

// Get indexes grouped by category (preserves original order within each category)
function getIndexesByCategory() {
    const categories = [];
    const categoryMap = new Map();

    state.indexes.forEach(idx => {
        const category = idx.category || 'Other';
        if (!categoryMap.has(category)) {
            categoryMap.set(category, []);
            categories.push(category);
        }
        categoryMap.get(category).push(idx);
    });

    return categories.map(cat => ({
        category: cat,
        indexes: categoryMap.get(cat)
    }));
}

function getIndexLabel(index) {
    if (!index) return '';
    if (index.label && typeof index.label === 'object') {
        const baseLabel = index.label.en || index.id || '';
        const unit = (index.unit || '').trim();
        return unit ? `${baseLabel} [${unit}]` : baseLabel;
    }
    const baseLabel = index.label || index.id || '';
    const unit = (index.unit || '').trim();
    return unit ? `${baseLabel} [${unit}]` : baseLabel;
}

// Generate HTML content for axis label tooltip
function getAxisLabelTooltipHtml(index) {
    if (!index) return '';

    const label = index.label || index.id || '';
    const source = index.source || '';
    const description = index.description || '';
    const scale = index.scale || {};
    const gradientClass = scale.gradientClass ? ` ${scale.gradientClass}` : '';

    let html = `<div class="axis-label-tooltip-header">
        <h4 class="axis-label-tooltip-title">${label}</h4>
        ${source ? `<span class="axis-label-tooltip-source">${source}</span>` : ''}
    </div>`;

    if (description) {
        html += `<p class="axis-label-tooltip-description">${description}</p>`;
    }

    if (scale.label || scale.lowLabel || scale.highLabel) {
        html += `<div class="axis-label-tooltip-scale">
            ${scale.label ? `<div class="axis-label-tooltip-scale-header">${scale.label}</div>` : ''}
            <div class="axis-label-tooltip-scale-bar">
                <div class="axis-label-tooltip-gradient${gradientClass}"></div>
                <div class="axis-label-tooltip-scale-labels">
                    <span class="axis-label-tooltip-scale-low">${scale.lowLabel || ''}</span>
                    <span class="axis-label-tooltip-scale-high">${scale.highLabel || ''}</span>
                </div>
            </div>
        </div>`;
    }

    return html;
}

// Create axis label tooltip element (singleton)
let axisLabelTooltip = null;
function getAxisLabelTooltip() {
    if (!axisLabelTooltip) {
        axisLabelTooltip = d3.select('body').append('div')
            .attr('class', 'axis-label-tooltip')
            .style('opacity', 0);
    }
    return axisLabelTooltip;
}

// Show axis label tooltip
function showAxisLabelTooltip(event, index) {
    const tooltip = getAxisLabelTooltip();
    const html = getAxisLabelTooltipHtml(index);

    if (!html) return;

    tooltip.html(html)
        .style('opacity', 1);

    // Position the tooltip
    const tooltipNode = tooltip.node();
    const tooltipRect = tooltipNode.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = event.clientX + 15;
    let top = event.clientY - 10;

    // Adjust if tooltip would go off right edge
    if (left + tooltipRect.width > viewportWidth - 20) {
        left = event.clientX - tooltipRect.width - 15;
    }

    // Adjust if tooltip would go off bottom edge
    if (top + tooltipRect.height > viewportHeight - 20) {
        top = viewportHeight - tooltipRect.height - 20;
    }

    // Ensure tooltip doesn't go off top edge
    if (top < 10) {
        top = 10;
    }

    tooltip.style('left', left + 'px')
        .style('top', top + 'px');
}

// Hide axis label tooltip
function hideAxisLabelTooltip() {
    const tooltip = getAxisLabelTooltip();
    tooltip.style('opacity', 0);
}

// Load year range from API (optionally filtered by indexes)
async function loadYearRange(xIndex = null, yIndex = null) {
    try {
        let url = '/api/years';
        if (xIndex && yIndex) {
            url += `?xIndex=${xIndex}&yIndex=${yIndex}`;
        }
        const response = await fetch(url);
        const yearRange = await response.json();
        console.log('Year range loaded:', yearRange);
        return yearRange;
    } catch (error) {
        console.error('Error loading year range:', error);
        return null;
    }
}

// Update year range for a specific plot based on selected indexes
async function updatePlotYearRange(plotNum) {
    const xAxisEl = document.getElementById(`xAxis${plotNum}`);
    const yAxisEl = document.getElementById(`yAxis${plotNum}`);

    if (!xAxisEl || !yAxisEl || !xAxisEl.value || !yAxisEl.value) {
        return;
    }

    const xIndex = xAxisEl.value;
    const yIndex = yAxisEl.value;

    const yearRange = await loadYearRange(xIndex, yIndex);

    if (!yearRange || !yearRange.min_year || !yearRange.max_year) {
        console.warn(`No year range available for plot ${plotNum}`);
        return;
    }

    state.plotYearRanges[plotNum] = yearRange;
    updateCompareYearSlider();
    // Ensure both plots reflect any clamped year value
    updatePlot(1);
    if (isSecondPlotActive()) {
        updatePlot(2);
    }
    console.log(`Plot ${plotNum} year range updated: ${yearRange.min_year}-${yearRange.max_year}`);
}

// Load countries from API
async function loadCountries() {
    try {
        const response = await fetch('/api/countries');
        state.countries = await response.json();

        // Create maps for quick lookups
        state.countryMap = {};
        state.continentMap = {};
        state.countries.forEach(country => {
            const label = buildCountryLabel(country.country_name, country.flag);
            state.countryMap[country.country_code] = {
                name: (country.country_name || country.country_code).trim(),
                flag: country.flag || '',
                label
            };
            state.continentMap[country.country_code] = country.continent;
        });

        console.log('Countries loaded:', state.countries.length);
    } catch (error) {
        console.error('Error loading countries:', error);
    }
}

// Populate axis selectors with indexes grouped by category (searchable dropdown)
function populateAxisSelectors() {
    const selectors = ['xAxis1', 'yAxis1', 'xAxis2', 'yAxis2', 'sizeAxis1', 'sizeAxis2'];
    const groupedIndexes = getIndexesByCategory();

    selectors.forEach((selectorId) => {
        const container = document.getElementById(`${selectorId}-container`);
        const hiddenInput = document.getElementById(selectorId);
        const valueDisplay = document.getElementById(`${selectorId}-value`);
        const optionsContainer = document.getElementById(`${selectorId}-options`);
        const searchInput = container?.querySelector('.searchable-select-search');
        const isSizeSelector = selectorId.startsWith('sizeAxis');

        if (!container || !hiddenInput || !optionsContainer) {
            console.error(`Searchable select for ${selectorId} not found`);
            return;
        }

        optionsContainer.innerHTML = '';

        // Add "None" option at the top for size selectors
        if (isSizeSelector) {
            const noneOption = document.createElement('div');
            noneOption.className = 'searchable-select-option searchable-select-option-none';
            noneOption.dataset.value = '';
            noneOption.dataset.label = 'Disable size modality';
            noneOption.textContent = 'Disable size modality';
            noneOption.addEventListener('click', (e) => {
                e.stopPropagation();
                selectSearchableOption(selectorId, '', 'Disable size modality');
            });
            optionsContainer.appendChild(noneOption);
        }

        // Create groups for each category
        groupedIndexes.forEach(group => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'searchable-select-group';
            groupDiv.dataset.category = group.category;

            const header = document.createElement('div');
            header.className = 'searchable-select-group-header';
            header.textContent = group.category;
            groupDiv.appendChild(header);

            group.indexes.forEach(indexData => {
                const option = document.createElement('div');
                option.className = 'searchable-select-option';
                option.dataset.value = indexData.id;
                option.dataset.label = getIndexLabel(indexData);
                option.textContent = getIndexLabel(indexData);

                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectSearchableOption(selectorId, indexData.id, getIndexLabel(indexData));
                });

                groupDiv.appendChild(option);
            });

            optionsContainer.appendChild(groupDiv);
        });

        // Set default selections
        let defaultValue = null;
        if (selectorId === 'xAxis1') defaultValue = 'democracy_index';
        if (selectorId === 'yAxis1') defaultValue = 'corruption';
        if (selectorId === 'xAxis2') defaultValue = 'hdi';
        if (selectorId === 'yAxis2') defaultValue = 'fertility';
        if (selectorId === 'sizeAxis1') defaultValue = 'population';

        if (defaultValue) {
            const defaultIndex = state.indexes.find(i => i.id === defaultValue);
            if (defaultIndex) {
                selectSearchableOption(selectorId, defaultValue, getIndexLabel(defaultIndex), false);
            }
        }

        // Size selectors default to "None" (unless already set above)
        if (isSizeSelector && !defaultValue) {
            selectSearchableOption(selectorId, '', 'Disable size modality', false);
        }

        // Setup event handlers
        setupSearchableSelectEvents(selectorId);
    });

    console.log('Axis selectors populated');
}

// Select an option in searchable dropdown
function selectSearchableOption(selectorId, value, label, triggerChange = true) {
    const container = document.getElementById(`${selectorId}-container`);
    const hiddenInput = document.getElementById(selectorId);
    const valueDisplay = document.getElementById(`${selectorId}-value`);
    const optionsContainer = document.getElementById(`${selectorId}-options`);

    if (!container || !hiddenInput || !valueDisplay) return;

    // Update hidden input
    const oldValue = hiddenInput.value;
    hiddenInput.value = value;

    // Update display
    valueDisplay.textContent = label;
    valueDisplay.classList.remove('placeholder');
    valueDisplay.classList.toggle('muted', value === '' && label === 'Disable size modality');

    // Update selected state in options
    optionsContainer.querySelectorAll('.searchable-select-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });

    // Close dropdown
    container.classList.remove('open');

    // Clear search
    const searchInput = container.querySelector('.searchable-select-search');
    if (searchInput) {
        searchInput.value = '';
        filterSearchableOptions(selectorId, '');
    }

    // Trigger change event if value changed
    if (triggerChange && oldValue !== value) {
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

// Filter options based on search query
function filterSearchableOptions(selectorId, query) {
    const optionsContainer = document.getElementById(`${selectorId}-options`);
    if (!optionsContainer) return;

    const normalizedQuery = query.toLowerCase().trim();
    let hasVisibleOptions = false;

    optionsContainer.querySelectorAll('.searchable-select-group').forEach(group => {
        let groupHasVisible = false;

        group.querySelectorAll('.searchable-select-option').forEach(option => {
            const label = option.dataset.label.toLowerCase();
            const isVisible = !normalizedQuery || label.includes(normalizedQuery);
            option.classList.toggle('hidden', !isVisible);
            if (isVisible) groupHasVisible = true;
        });

        group.classList.toggle('hidden', !groupHasVisible);
        if (groupHasVisible) hasVisibleOptions = true;
    });

    // Show/hide no results message
    let noResultsEl = optionsContainer.querySelector('.searchable-select-no-results');
    if (!hasVisibleOptions) {
        if (!noResultsEl) {
            noResultsEl = document.createElement('div');
            noResultsEl.className = 'searchable-select-no-results';
            noResultsEl.textContent = 'No indexes found';
            optionsContainer.appendChild(noResultsEl);
        }
        noResultsEl.style.display = 'block';
    } else if (noResultsEl) {
        noResultsEl.style.display = 'none';
    }
}

// Setup event handlers for searchable select
function setupSearchableSelectEvents(selectorId) {
    const container = document.getElementById(`${selectorId}-container`);
    const trigger = container?.querySelector('.searchable-select-trigger');
    const searchInput = container?.querySelector('.searchable-select-search');
    const dropdown = container?.querySelector('.searchable-select-dropdown');

    if (!container || !trigger) return;

    // Toggle dropdown on trigger click
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = container.classList.contains('open');

        // Close all other searchable selects
        document.querySelectorAll('.searchable-select.open').forEach(el => {
            if (el !== container) el.classList.remove('open');
        });

        container.classList.toggle('open', !wasOpen);

        if (!wasOpen && searchInput) {
            setTimeout(() => searchInput.focus(), 10);
        }
    });

    // Search input handler
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterSearchableOptions(selectorId, e.target.value);
        });

        searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Keyboard navigation
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                container.classList.remove('open');
            } else if (e.key === 'Enter') {
                const visibleOption = container.querySelector('.searchable-select-option:not(.hidden)');
                if (visibleOption) {
                    visibleOption.click();
                }
            }
        });
    }

    // Prevent dropdown clicks from closing
    if (dropdown) {
        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
}

// Close searchable selects when clicking outside
document.addEventListener('click', () => {
    document.querySelectorAll('.searchable-select.open').forEach(el => {
        el.classList.remove('open');
    });
});

// Update shared compare year slider with current combined range
function updateCompareYearSlider(rangeOverride = null) {
    const slider = document.getElementById('compareYearSlider');
    const inputEl = document.getElementById('compareYearInput');
    const minEl = document.getElementById('compareYearMin');
    const maxEl = document.getElementById('compareYearMax');

    if (
        !slider ||
        !state.yearRange ||
        state.yearRange.min_year === null ||
        state.yearRange.max_year === null
    ) {
        return;
    }

    // Combine plot-specific ranges (union) to show the full range across both plots
    const ranges = Object.values(state.plotYearRanges || {}).filter(Boolean);
    const baseRange = rangeOverride || state.yearRange;
    let minYear = baseRange.min_year;
    let maxYear = baseRange.max_year;

    if (ranges.length > 0) {
        const combinedMin = Math.min(...ranges.map(r => r.min_year));
        const combinedMax = Math.max(...ranges.map(r => r.max_year));
        minYear = combinedMin;
        maxYear = combinedMax;
    }

    const currentValue = parseInt(slider.value, 10);
    slider.min = minYear;
    slider.max = maxYear;
    const defaultValue = maxYear;
    // Use default if value is NaN or outside the valid year range (e.g., browser default of 50)
    const isValidYear = !isNaN(currentValue) && currentValue >= minYear && currentValue <= maxYear;
    const newValue = isValidYear ? currentValue : defaultValue;
    slider.value = newValue;

    if (inputEl) {
        inputEl.value = newValue;
        inputEl.min = minYear;
        inputEl.max = maxYear;
    }

    if (minEl) minEl.textContent = minYear;
    if (maxEl) maxEl.textContent = maxYear;

    console.log(`Compare year slider range: ${minYear}-${maxYear}, value: ${newValue}`);
}

// Position year input above slider thumb
function updateYearInputPosition(slider, yearInput) {
    if (!slider || !yearInput) return;

    // Skip positioning for raw data year input (it uses a different fixed layout)
    const wrapper = slider.closest('.slider-wrapper, .raw-data-slider-wrapper');
    if (!wrapper) return;

    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const value = parseFloat(slider.value);

    const percentage = (value - min) / (max - min);
    const sliderRect = slider.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();

    // Calculate thumb position relative to wrapper
    const sliderOffsetLeft = sliderRect.left - wrapperRect.left;
    const thumbPosition = sliderOffsetLeft + (percentage * sliderRect.width);

    // Center the input on the thumb
    const inputWidth = yearInput.offsetWidth;
    const left = thumbPosition - (inputWidth / 2);

    // Clamp to stay within bounds
    const maxLeft = wrapperRect.width - inputWidth;
    const clampedLeft = Math.max(0, Math.min(left, maxLeft));

    yearInput.style.left = `${clampedLeft}px`;
    yearInput.style.transform = 'none';
}

// Shared compare year controls
function initializeCompareYearControls() {
    const yearSlider = document.getElementById('compareYearSlider');
    const yearInput = document.getElementById('compareYearInput');
    const yearModeSlider = document.getElementById('yearModeSlider');
    const yearModeAll = document.getElementById('yearModeAll');
    const yearModeAveraged = document.getElementById('yearModeAveraged');

    if (!yearSlider || !yearInput) return;

    // Initialize range and value
    updateCompareYearSlider();

    const updatePlots = () => {
        updatePlot(1);
        if (isSecondPlotActive()) {
            updatePlot(2);
        }
    };

    // Sync slider to input
    yearSlider.addEventListener('input', (e) => {
        yearInput.value = e.target.value;
        updatePlots();
    });

    // Sync input to slider
    yearInput.addEventListener('input', (e) => {
        let value = parseInt(e.target.value, 10);
        const min = parseInt(yearSlider.min, 10);
        const max = parseInt(yearSlider.max, 10);
        if (!isNaN(value)) {
            value = Math.max(min, Math.min(max, value));
            yearSlider.value = value;
            updatePlots();
        }
    });

    // Clamp on blur
    yearInput.addEventListener('blur', (e) => {
        let value = parseInt(e.target.value, 10);
        const min = parseInt(yearSlider.min, 10);
        const max = parseInt(yearSlider.max, 10);
        if (isNaN(value) || value < min) value = min;
        if (value > max) value = max;
        yearInput.value = value;
        yearSlider.value = value;
    });

    function handleYearModeChange() {
        const modeEl = document.querySelector('input[name="compareYearMode"]:checked');
        const mode = modeEl ? modeEl.value : 'slider';
        const isSlider = mode === 'slider';
        yearSlider.disabled = !isSlider;
        yearInput.disabled = !isSlider;
        updatePlots();
    }

    if (yearModeSlider) yearModeSlider.addEventListener('change', handleYearModeChange);
    if (yearModeAll) yearModeAll.addEventListener('change', handleYearModeChange);
    if (yearModeAveraged) yearModeAveraged.addEventListener('change', handleYearModeChange);
}

// Initialize plot - returns a promise that resolves when the plot is fully rendered
async function initializePlot(plotNum) {
    const xAxisSelect = document.getElementById(`xAxis${plotNum}`);
    const yAxisSelect = document.getElementById(`yAxis${plotNum}`);
    const sizeAxisSelect = document.getElementById(`sizeAxis${plotNum}`);

    if (plotNum === 2) {
        state.secondPlotInitialized = true;
    }

    // Sync slider to input and update position

    // Always color by continent and lock axis range; clear hidden continents if any were stored
    delete state.hiddenContinents[plotNum];

    // Handle axis swap button
    const swapBtn = document.querySelector(`.axis-swap-btn[data-plot="${plotNum}"]`);
    if (swapBtn) {
        swapBtn.addEventListener('click', async () => {
            // Get current values and labels
            const xValue = xAxisSelect.value;
            const yValue = yAxisSelect.value;
            const xValueDisplay = document.getElementById(`xAxis${plotNum}-value`);
            const yValueDisplay = document.getElementById(`yAxis${plotNum}-value`);
            const xLabel = xValueDisplay ? xValueDisplay.textContent : '';
            const yLabel = yValueDisplay ? yValueDisplay.textContent : '';

            // Swap using the searchable select function
            selectSearchableOption(`xAxis${plotNum}`, yValue, yLabel, false);
            selectSearchableOption(`yAxis${plotNum}`, xValue, xLabel, false);

            // Clear zoom state when swapping axes
            delete state.zoomState[plotNum];

            // Update the plot
            await updatePlotYearRange(plotNum);
        });
    }

    // Update plot on axis change (also update year range)
    xAxisSelect.addEventListener('change', async () => {
        // Clear cached axis range and zoom state when axis changes
        const cacheKey = `${plotNum}-${xAxisSelect.value}-${yAxisSelect.value}`;
        delete state.lockedAxisRanges[cacheKey];
        delete state.zoomState[plotNum];
        await updatePlotYearRange(plotNum);
    });
    yAxisSelect.addEventListener('change', async () => {
        // Clear cached axis range and zoom state when axis changes
        const cacheKey = `${plotNum}-${xAxisSelect.value}-${yAxisSelect.value}`;
        delete state.lockedAxisRanges[cacheKey];
        delete state.zoomState[plotNum];
        await updatePlotYearRange(plotNum);
    });

    // Update plot when size axis changes
    if (sizeAxisSelect) {
        sizeAxisSelect.addEventListener('change', async () => {
            await updatePlot(plotNum);
        });
    }

    // Initial year range and plot - await completion
    await updatePlotYearRange(plotNum);
    await updatePlot(plotNum);
}

// Update plot with data
async function updatePlot(plotNum) {
    const xAxisEl = document.getElementById(`xAxis${plotNum}`);
    const yAxisEl = document.getElementById(`yAxis${plotNum}`);
    const sizeAxisEl = document.getElementById(`sizeAxis${plotNum}`);
    const yearSliderEl = document.getElementById('compareYearSlider');

    // Safety check - don't update if elements don't exist or have no value
    if (!xAxisEl || !yAxisEl || !yearSliderEl || !xAxisEl.value || !yAxisEl.value) {
        console.log(`Plot ${plotNum} not ready yet`);
        return;
    }

    const xAxis = xAxisEl.value;
    const yAxis = yAxisEl.value;
    const sizeAxis = sizeAxisEl ? sizeAxisEl.value : '';
    const year = yearSliderEl.value;

    // Get year mode from radio buttons
    const yearModeEl = document.querySelector('input[name="compareYearMode"]:checked');
    const yearMode = yearModeEl ? yearModeEl.value : 'slider';
    const allYears = yearMode === 'all';
    const allYearsAveraged = yearMode === 'averaged';
    const lockAxisRange = true;

    try {
        let url;
        let data;

        const sizeParam = sizeAxis ? `&sizeIndex=${sizeAxis}` : '';

        if (allYears || allYearsAveraged) {
            url = `/api/data?xIndex=${xAxis}&yIndex=${yAxis}${sizeParam}&allYears=true`;
        } else {
            url = `/api/data?year=${year}&xIndex=${xAxis}&yIndex=${yAxis}${sizeParam}`;
        }

        console.log(`Fetching data for plot ${plotNum}:`, url);
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`API error: ${response.status} ${response.statusText}`);
            return;
        }

        data = await response.json();
        console.log(`Received ${data.length} data points for plot ${plotNum}`);

        // If averaging, calculate average values per country
        if (allYearsAveraged) {
            data = calculateAveragedData(data, !!sizeAxis);
            console.log(`Averaged to ${data.length} data points`);
        }

        // Get fixed axis range if lock is enabled
        let fixedRange = null;
        if (lockAxisRange && !allYears && !allYearsAveraged) {
            const cacheKey = `${plotNum}-${xAxis}-${yAxis}`;

            // Check if we have cached range
            if (state.lockedAxisRanges[cacheKey]) {
                fixedRange = state.lockedAxisRanges[cacheKey];
            } else {
                // Fetch all years data to calculate full range
                const allDataUrl = `/api/data?xIndex=${xAxis}&yIndex=${yAxis}&allYears=true`;
                const allDataResponse = await fetch(allDataUrl);
                if (allDataResponse.ok) {
                    const allData = await allDataResponse.json();
                    if (allData.length > 0) {
                        fixedRange = {
                            xExtent: [
                                Math.min(...allData.map(d => d.x_value)),
                                Math.max(...allData.map(d => d.x_value))
                            ],
                            yExtent: [
                                Math.min(...allData.map(d => d.y_value)),
                                Math.max(...allData.map(d => d.y_value))
                            ]
                        };
                        // Cache the range
                        state.lockedAxisRanges[cacheKey] = fixedRange;
                    }
                }
            }
        }

        // Fetch size range if size axis is active
        let sizeRange = null;
        if (sizeAxis) {
            try {
                const sizeRangeResponse = await fetch(`/api/index-range?index=${sizeAxis}`);
                if (sizeRangeResponse.ok) {
                    sizeRange = await sizeRangeResponse.json();
                }
            } catch (e) {
                console.error('Error fetching size range:', e);
            }
        }

        // Check if X and Y axes are the same - render histogram instead of scatter plot
        if (xAxis === yAxis) {
            renderHistogram(plotNum, data, xAxis, allYears ? 'all' : (allYearsAveraged ? 'averaged' : year), fixedRange);
        } else {
            renderScatterPlot(plotNum, data, xAxis, yAxis, allYears ? 'all' : (allYearsAveraged ? 'averaged' : year), fixedRange, sizeAxis || null, sizeRange);
        }
    } catch (error) {
        console.error('Error loading plot data:', error);
    }
}

// Calculate averaged data across all years for each country
function calculateAveragedData(data, hasSize = false) {
    const countryData = {};

    // Group data by country
    data.forEach(item => {
        if (!countryData[item.country_code]) {
            countryData[item.country_code] = {
                country_code: item.country_code,
                country_name: item.country_name,
                x_values: [],
                y_values: [],
                s_values: []
            };
        }
        countryData[item.country_code].x_values.push(item.x_value);
        countryData[item.country_code].y_values.push(item.y_value);
        if (hasSize && item.s_value != null) {
            countryData[item.country_code].s_values.push(item.s_value);
        }
    });

    // Calculate averages
    const averaged = Object.values(countryData).map(country => {
        const result = {
            country_code: country.country_code,
            country_name: country.country_name,
            x_value: country.x_values.reduce((sum, val) => sum + val, 0) / country.x_values.length,
            y_value: country.y_values.reduce((sum, val) => sum + val, 0) / country.y_values.length,
            year: 'avg'
        };
        if (hasSize && country.s_values.length > 0) {
            result.s_value = country.s_values.reduce((sum, val) => sum + val, 0) / country.s_values.length;
        }
        return result;
    });

    return averaged;
}

// Render D3 scatter plot
function renderScatterPlot(plotNum, data, xAxisId, yAxisId, year, fixedRange = null, sizeAxisId = null, sizeRange = null) {
    const plotDiv = document.getElementById(`plot${plotNum}`);
    plotDiv.innerHTML = ''; // Clear previous plot

    console.log(`Rendering plot ${plotNum} with ${data.length} data points`);

    if (data.length === 0) {
        plotDiv.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">No data available</div>';
        return;
    }

    // Responsive margins based on screen size
    // Top margin increased to accommodate legend without overlap
    const isSmallScreen = window.innerWidth < 768;
    const isMediumScreen = window.innerWidth < 1024 && window.innerWidth >= 768;

    let margin;
    if (isSmallScreen) {
        margin = { top: 40, right: 20, bottom: 60, left: 60 };
    } else if (isMediumScreen) {
        margin = { top: 45, right: 25, bottom: 65, left: 70 };
    } else {
        margin = { top: 50, right: 30, bottom: 70, left: 80 };
    }

    let width = plotDiv.clientWidth - margin.left - margin.right;
    let height = plotDiv.clientHeight - margin.top - margin.bottom;

    // Ensure plots are perfectly square - use the smaller dimension
    const plotSize = Math.min(width, height);
    width = plotSize;
    height = plotSize;

    // Ensure minimum dimensions
    if (width < 100 || height < 100) {
        console.warn(`Plot ${plotNum} dimensions too small: ${width}x${height}`);
        return;
    }

    console.log(`Plot ${plotNum} square dimensions: ${width}x${height}`);

    // Create SVG
    const svg = d3.select(`#plot${plotNum}`)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Get axis labels
    const xIndex = state.indexes.find(i => i.id === xAxisId);
    const yIndex = state.indexes.find(i => i.id === yAxisId);
    const xLabel = getIndexLabel(xIndex) || xAxisId;
    const yLabel = getIndexLabel(yIndex) || yAxisId;

    // Size axis label (if active)
    let sizeLabel = null;
    if (sizeAxisId) {
        const sizeIndex = state.indexes.find(i => i.id === sizeAxisId);
        sizeLabel = getIndexLabel(sizeIndex) || sizeAxisId;
    }

    console.log(`Plot ${plotNum} labels: X="${xLabel}", Y="${yLabel}"${sizeLabel ? `, Size="${sizeLabel}"` : ''}`);

    // Scales with reduced padding on all sides
    // Use fixed range if provided (for locked axis mode), otherwise calculate from data
    const xExtent = fixedRange ? fixedRange.xExtent : d3.extent(data, d => d.x_value);
    const yExtent = fixedRange ? fixedRange.yExtent : d3.extent(data, d => d.y_value);

    // Calculate asymmetric padding (slightly tighter on top/right)
    const xRange = xExtent[1] - xExtent[0];
    const yRange = yExtent[1] - yExtent[0];
    const paddingMinFactor = 0.04;  // modest buffer below/left
    const paddingMaxFactor = 0.02;  // modest buffer above/right
    const xPaddingMin = xRange * paddingMinFactor;
    const xPaddingMax = xRange * paddingMaxFactor;
    const yPaddingMin = yRange * paddingMinFactor;
    const yPaddingMax = yRange * paddingMaxFactor;

    const xScale = d3.scaleLinear()
        .domain([xExtent[0] - xPaddingMin, xExtent[1] + xPaddingMax])
        .range([0, width]);

    const yScale = d3.scaleLinear()
        .domain([yExtent[0] - yPaddingMin, yExtent[1] + yPaddingMax])
        .range([height, 0]);

    // Store original domains for reset
    const originalXDomain = xScale.domain();
    const originalYDomain = yScale.domain();

    // Apply saved zoom state if exists
    const savedZoom = state.zoomState[plotNum];
    if (savedZoom && savedZoom.xAxis === xAxisId && savedZoom.yAxis === yAxisId) {
        xScale.domain(savedZoom.xDomain);
        yScale.domain(savedZoom.yDomain);
    }

    // Responsive tick count
    const tickCount = isSmallScreen ? 4 : (isMediumScreen ? 5 : 6);

    // Add clip path to prevent points from showing outside plot area
    svg.append('defs').append('clipPath')
        .attr('id', `clip-${plotNum}`)
        .append('rect')
        .attr('width', width)
        .attr('height', height);

    // Grid lines
    const gridY = svg.append('g')
        .attr('class', 'grid')
        .attr('opacity', 0.2);

    const gridX = svg.append('g')
        .attr('class', 'grid')
        .attr('transform', `translate(0,${height})`)
        .attr('opacity', 0.2);

    // Axes
    const xAxisGroup = svg.append('g')
        .attr('class', 'axis x-axis')
        .attr('transform', `translate(0,${height})`);

    const yAxisGroup = svg.append('g')
        .attr('class', 'axis y-axis');

    // Function to update axes and grid (duration=0 for instant update during drag)
    function updateAxesAndGrid(duration) {
        const useTransition = duration !== 0;

        if (useTransition) {
            gridY.call(d3.axisLeft(yScale)
                .ticks(tickCount)
                .tickSize(-width)
                .tickFormat(''));

            gridX.call(d3.axisBottom(xScale)
                .ticks(tickCount)
                .tickSize(-height)
                .tickFormat(''));

            xAxisGroup.call(d3.axisBottom(xScale)
                .ticks(tickCount)
                .tickFormat(formatAxisTick));
            yAxisGroup.call(d3.axisLeft(yScale)
                .ticks(tickCount)
                .tickFormat(formatAxisTick));
        } else {
            // Instant update (no transition) for smooth panning
            gridY.call(d3.axisLeft(yScale)
                .ticks(tickCount)
                .tickSize(-width)
                .tickFormat(''));

            gridX.call(d3.axisBottom(xScale)
                .ticks(tickCount)
                .tickSize(-height)
                .tickFormat(''));

            xAxisGroup.call(d3.axisBottom(xScale)
                .ticks(tickCount)
                .tickFormat(formatAxisTick));
            yAxisGroup.call(d3.axisLeft(yScale)
                .ticks(tickCount)
                .tickFormat(formatAxisTick));
        }
    }

    // Initial render
    updateAxesAndGrid();

    // Axis labels with responsive sizing
    const labelFontSize = isSmallScreen ? '14px' : (isMediumScreen ? '16px' : '18px');
    const xLabelY = isSmallScreen ? height + 45 : height + 50;
    const yLabelY = isSmallScreen ? -35 : -45;

    // X axis label with tooltip
    svg.append('text')
        .attr('class', 'axis-label hoverable')
        .attr('text-anchor', 'middle')
        .attr('x', width / 2)
        .attr('y', xLabelY)
        .style('fill', getComputedStyle(document.body).getPropertyValue('--text-primary'))
        .style('font-size', labelFontSize)
        .style('font-weight', '500')
        .text(xLabel)
        .on('mouseenter', function(event) {
            showAxisLabelTooltip(event, xIndex);
        })
        .on('mousemove', function(event) {
            showAxisLabelTooltip(event, xIndex);
        })
        .on('mouseleave', function() {
            hideAxisLabelTooltip();
        });

    // Y axis label with tooltip
    svg.append('text')
        .attr('class', 'axis-label hoverable')
        .attr('text-anchor', 'middle')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', yLabelY)
        .style('fill', getComputedStyle(document.body).getPropertyValue('--text-primary'))
        .style('font-size', labelFontSize)
        .style('font-weight', '500')
        .text(yLabel)
        .on('mouseenter', function(event) {
            showAxisLabelTooltip(event, yIndex);
        })
        .on('mousemove', function(event) {
            showAxisLabelTooltip(event, yIndex);
        })
        .on('mouseleave', function() {
            hideAxisLabelTooltip();
        });

    // Tooltip
    const tooltip = d3.select('body').append('div')
        .attr('class', 'tooltip')
        .style('opacity', 0);

    // Always color by continent
    const colorByContinent = true;

    // Continent color scale - high contrast palette for clear distinction
    const continentColors = {
        'Africa': '#f97316',        // Orange
        'Asia': '#a855f7',          // Vivid purple
        'Europe': '#2563eb',        // Royal blue
        'North America': '#22c55e', // Vivid green
        'South America': '#ef4444', // Red
        'Oceania': '#eab308',       // Golden yellow
        'Antarctica': '#64748b'     // Slate gray
    };

    // Color scale for years (kept for potential future use when not coloring by continent)
    let colorScale;

    // Responsive point sizes
    const baseRadius = year === 'all'
        ? (isSmallScreen ? 2.5 : 3)
        : (isSmallScreen ? 4 : 5);
    const hoverRadiusFixed = year === 'all'
        ? (isSmallScreen ? 5 : 6)
        : (isSmallScreen ? 7 : 8);

    // Size scale for variable point sizing
    let sizeScale = null;
    if (sizeAxisId && sizeRange && sizeRange.min_value != null && sizeRange.max_value != null) {
        const minRadius = year === 'all' ? (isSmallScreen ? 1.5 : 2) : (isSmallScreen ? 2 : 3);
        const maxRadius = year === 'all' ? (isSmallScreen ? 7 : 9) : (isSmallScreen ? 10 : 14);
        sizeScale = d3.scaleSqrt()
            .domain([sizeRange.min_value, sizeRange.max_value])
            .range([minRadius, maxRadius])
            .clamp(true);
    }

    // Helper to get point radius
    const getPointRadius = (d) => sizeScale && d.s_value != null ? sizeScale(d.s_value) : baseRadius;
    const getHoverRadius = (d) => sizeScale && d.s_value != null ? sizeScale(d.s_value) * 1.5 : hoverRadiusFixed;

    // Track if we're in pan mode (zoomed in)
    const isZoomed = () => !!state.zoomState[plotNum];

    // Zoom functionality with brush - ADD FIRST so it's underneath
    const brush = d3.brush()
        .extent([[0, 0], [width, height]])
        .filter(event => !event.button && !isZoomed()) // Only when not zoomed
        .on('end', brushEnded);

    const brushGroup = svg.append('g')
        .attr('class', 'brush')
        .call(brush);

    // Pan functionality - drag behavior for when zoomed
    let panStartX, panStartY, panStartXDomain, panStartYDomain;

    const drag = d3.drag()
        .filter(event => !event.button && isZoomed()) // Only when zoomed
        .on('start', function(event) {
            if (!isZoomed()) return;
            panStartX = event.x;
            panStartY = event.y;
            panStartXDomain = xScale.domain().slice();
            panStartYDomain = yScale.domain().slice();
            d3.select(this).style('cursor', 'grabbing');
        })
        .on('drag', function(event) {
            if (!isZoomed() || !panStartXDomain) return;

            const dx = event.x - panStartX;
            const dy = event.y - panStartY;

            // Convert pixel movement to domain units
            const xRange = xScale.range();
            const yRange = yScale.range();
            const xDomainWidth = panStartXDomain[1] - panStartXDomain[0];
            const yDomainHeight = panStartYDomain[1] - panStartYDomain[0];

            const xShift = -dx * xDomainWidth / (xRange[1] - xRange[0]);
            const yShift = dy * yDomainHeight / (yRange[0] - yRange[1]); // y is inverted

            // Apply pan
            xScale.domain([panStartXDomain[0] + xShift, panStartXDomain[1] + xShift]);
            yScale.domain([panStartYDomain[0] + yShift, panStartYDomain[1] + yShift]);

            // Update zoom state
            state.zoomState[plotNum] = {
                xDomain: xScale.domain(),
                yDomain: yScale.domain(),
                xAxis: xAxisId,
                yAxis: yAxisId
            };

            // Update display (no transition for smooth dragging)
            updateAxesAndGrid(0);
            circles
                .attr('cx', d => xScale(d.x_value))
                .attr('cy', d => yScale(d.y_value));
        })
        .on('end', function() {
            d3.select(this).style('cursor', isZoomed() ? 'grab' : 'crosshair');
        });

    // Apply drag to the brush overlay (the interactive area)
    brushGroup.select('.overlay').call(drag);

    // Update cursor based on zoom state
    function updateCursor() {
        const cursor = isZoomed() ? 'grab' : 'crosshair';
        brushGroup.select('.overlay').style('cursor', cursor);
    }

    // Initial cursor
    updateCursor();

    // Create a group for points with clip path - ADD AFTER brush so circles are on top
    const pointsGroup = svg.append('g')
        .attr('clip-path', `url(#clip-${plotNum})`);

    // Helper to check if point should be hidden due to missing size data
    const isMissingSizeData = (d) => sizeScale && d.s_value == null;

    // Points
    const circles = pointsGroup.selectAll('circle')
        .data(data)
        .enter()
        .append('circle')
        .attr('cx', d => xScale(d.x_value))
        .attr('cy', d => yScale(d.y_value))
        .attr('r', d => getPointRadius(d))
        .style('display', d => isMissingSizeData(d) ? 'none' : null)
        .style('fill', d => {
            if (colorByContinent) {
                const continent = state.continentMap[d.country_code];
                return continentColors[continent] || '#2563eb';
            } else if (year === 'all') {
                return colorScale(d.year);
            } else {
                return '#2563eb';
            }
        })
        .style('opacity', year === 'all' ? 0.5 : 0.7)
        .style('stroke', 'rgba(255, 255, 255, 0.5)')
        .style('stroke-width', 0.5)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            d3.select(this)
                .transition()
                .duration(200)
                .attr('r', getHoverRadius(d))
                .style('opacity', 1);

            tooltip.transition()
                .duration(200)
                .style('opacity', 1);

            const countryName = getCountryLabel(d.country_code);
            const countryDisplay = `${countryName} (${d.country_code})`;

            // Get continent color for the tooltip
            let countryColor = '#2563eb'; // default blue
            if (colorByContinent) {
                const continent = state.continentMap[d.country_code];
                countryColor = continentColors[continent] || '#2563eb';
            }

            let tooltipContent;
            if (year === 'all') {
                tooltipContent = `<strong style="color: ${countryColor};">${countryDisplay}</strong><br/><span style="color: var(--text-secondary); font-size: 0.8125rem;">Year: ${d.year}</span><br/>${xLabel}: ${formatTooltipValue(d.x_value)}<br/>${yLabel}: ${formatTooltipValue(d.y_value)}`;
            } else if (year === 'averaged') {
                tooltipContent = `<strong style="color: ${countryColor};">${countryDisplay}</strong><br/><span style="color: var(--text-secondary); font-size: 0.8125rem;">Averaged across all years</span><br/>${xLabel}: ${formatTooltipValue(d.x_value)}<br/>${yLabel}: ${formatTooltipValue(d.y_value)}`;
            } else {
                tooltipContent = `<strong style="color: ${countryColor};">${countryDisplay}</strong><br/>${xLabel}: ${formatTooltipValue(d.x_value)}<br/>${yLabel}: ${formatTooltipValue(d.y_value)}`;
            }

            // Add size info to tooltip if size axis is active
            if (sizeLabel && d.s_value != null) {
                tooltipContent += `<br/>${sizeLabel}: ${formatTooltipValue(d.s_value)}`;
            }

            tooltip.html(tooltipContent)
                .style('left', (event.clientX + 10) + 'px')
                .style('top', (event.clientY - 28) + 'px');
        })
        .on('mouseout', function(event, d) {
            d3.select(this)
                .transition()
                .duration(200)
                .attr('r', getPointRadius(d))
                .style('opacity', year === 'all' ? 0.5 : 0.7);

            tooltip.transition()
                .duration(500)
                .style('opacity', 0);
        });

    function brushEnded(event) {
        if (!event.selection) return; // Ignore empty selections

        const [[x0, y0], [x1, y1]] = event.selection;

        // Update scale domains based on selection
        xScale.domain([xScale.invert(x0), xScale.invert(x1)]);
        yScale.domain([yScale.invert(y1), yScale.invert(y0)]); // y is inverted

        // Save zoom state for persistence during year slider changes
        state.zoomState[plotNum] = {
            xDomain: xScale.domain(),
            yDomain: yScale.domain(),
            xAxis: xAxisId,
            yAxis: yAxisId
        };

        // Clear the brush
        brushGroup.call(brush.move, null);

        // Update axes and grid
        updateAxesAndGrid();

        // Update points positions
        circles
            .transition()
            .duration(750)
            .attr('cx', d => xScale(d.x_value))
            .attr('cy', d => yScale(d.y_value));

        // Show reset button
        resetButton.style('display', 'block');

        // Switch to pan mode cursor
        updateCursor();
    }

    // Reset zoom function (shared between button and double-click)
    function resetZoom() {
        // Reset to original domains
        xScale.domain(originalXDomain);
        yScale.domain(originalYDomain);

        // Clear saved zoom state
        delete state.zoomState[plotNum];

        // Update axes and grid
        updateAxesAndGrid();

        // Update points positions
        circles
            .transition()
            .duration(750)
            .attr('cx', d => xScale(d.x_value))
            .attr('cy', d => yScale(d.y_value));

        // Hide reset button
        resetButton.style('display', 'none');

        // Switch back to zoom mode cursor
        updateCursor();
    }

    // Add reset zoom button (show if there's a saved zoom state)
    const hasZoom = savedZoom && savedZoom.xAxis === xAxisId && savedZoom.yAxis === yAxisId;
    const resetButton = d3.select(`#plot${plotNum}`)
        .append('button')
        .attr('class', 'reset-zoom-btn')
        .style('display', hasZoom ? 'block' : 'none')
        .text(t('reset-zoom'))
        .on('click', resetZoom);

    // Add double-click to reset zoom on the plot area
    svg.on('dblclick', function() {
        if (state.zoomState[plotNum]) {
            resetZoom();
        }
    });

    // Calculate legend offset to center it over the chart area (not the plot div)
    // The chart area is offset by margin.left from the plot div's left edge
    const legendOffset = (margin.left - margin.right) / 2;

    // Always create legend placeholder to reserve space
    const legendPlaceholder = d3.select(`#plot${plotNum}`)
        .append('div')
        .attr('class', 'legend-placeholder')
        .style('left', `calc(50% + ${legendOffset}px)`);

    // Add continent legend if coloring by continent
    if (colorByContinent) {
        // Get unique continents from the data
        const continentsInData = [...new Set(data.map(d => state.continentMap[d.country_code]).filter(c => c))].sort();

        // Use persisted hidden continents from state, or create new Set
        if (!state.hiddenContinents[plotNum]) {
            state.hiddenContinents[plotNum] = new Set();
        }
        const hiddenContinents = state.hiddenContinents[plotNum];

        // Apply initial visibility based on persisted state and missing size data
        circles.style('display', d => {
            if (isMissingSizeData(d)) return 'none';
            const pointContinent = state.continentMap[d.country_code];
            return hiddenContinents.has(pointContinent) ? 'none' : null;
        });

        const legend = d3.select(`#plot${plotNum}`)
            .append('div')
            .attr('class', 'continent-legend')
            .style('left', `calc(50% + ${legendOffset}px)`);

        continentsInData.forEach(continentEn => {
            const isHidden = hiddenContinents.has(continentEn);
            const item = legend.append('div')
                .attr('class', 'legend-item' + (isHidden ? ' legend-item-hidden' : ''))
                .style('cursor', 'pointer')
                .style('opacity', isHidden ? 0.3 : 1)
                .on('click', function() {
                    // Toggle continent visibility
                    if (hiddenContinents.has(continentEn)) {
                        hiddenContinents.delete(continentEn);
                        d3.select(this)
                            .style('opacity', null)
                            .classed('legend-item-hidden', false);
                    } else {
                        hiddenContinents.add(continentEn);
                        d3.select(this)
                            .style('opacity', 0.3)
                            .classed('legend-item-hidden', true);
                    }

                    // Update circles visibility
                    circles.style('display', d => {
                        if (isMissingSizeData(d)) return 'none';
                        const pointContinent = state.continentMap[d.country_code];
                        return hiddenContinents.has(pointContinent) ? 'none' : null;
                    });
                });

            item.append('div')
                .attr('class', 'legend-color')
                .style('background-color', continentColors[continentEn]);

            const continentDisplay = continentEn;
            item.append('span')
                .attr('class', 'legend-label')
                .text(continentDisplay);
        });
    }

    // Add point count badge (bottom-right corner)
    const visibleCount = sizeScale ? data.filter(d => d.s_value != null).length : data.length;
    d3.select(`#plot${plotNum}`)
        .append('div')
        .attr('class', 'plot-point-count')
        .text(`Points: ${visibleCount.toLocaleString('fr-FR')}`);
}

// Render histogram for single variable distribution
function renderHistogram(plotNum, data, indexId, year, fixedRange = null) {
    const plotDiv = document.getElementById(`plot${plotNum}`);
    plotDiv.innerHTML = ''; // Clear previous plot

    console.log(`Rendering histogram for plot ${plotNum} with ${data.length} data points`);

    if (data.length === 0) {
        plotDiv.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">No data available</div>';
        return;
    }

    // Responsive margins based on screen size
    // Top margin increased to accommodate legend without overlap
    const isSmallScreen = window.innerWidth < 768;
    const isMediumScreen = window.innerWidth < 1024 && window.innerWidth >= 768;

    let margin;
    if (isSmallScreen) {
        margin = { top: 40, right: 20, bottom: 60, left: 60 };
    } else if (isMediumScreen) {
        margin = { top: 45, right: 25, bottom: 65, left: 70 };
    } else {
        margin = { top: 50, right: 30, bottom: 70, left: 80 };
    }

    let width = plotDiv.clientWidth - margin.left - margin.right;
    let height = plotDiv.clientHeight - margin.top - margin.bottom;

    // Ensure plots are perfectly square - use the smaller dimension
    const plotSize = Math.min(width, height);
    width = plotSize;
    height = plotSize;

    // Ensure minimum dimensions
    if (width < 100 || height < 100) {
        console.warn(`Plot ${plotNum} dimensions too small: ${width}x${height}`);
        return;
    }

    console.log(`Plot ${plotNum} square dimensions: ${width}x${height}`);

    // Create SVG
    const svg = d3.select(`#plot${plotNum}`)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Get axis label
    const index = state.indexes.find(i => i.id === indexId);
    const label = getIndexLabel(index) || indexId;

    console.log(`Histogram label: "${label}"`);

    // Extract values and prepare data with country info
    const values = data.map(d => ({
        value: d.x_value,
        country_code: d.country_code,
        year: d.year
    })).filter(d => d.value != null);

    if (values.length === 0) {
        plotDiv.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">No data available</div>';
        return;
    }

    // Create histogram with 20 equal-width bins
    // Use fixed range if provided (for locked axis mode), otherwise calculate from data
    const extent = fixedRange ? fixedRange.xExtent : d3.extent(values, d => d.value);
    const dataRange = extent[1] - extent[0];

    // Calculate ideal bin width to fit 20 bins
    const binWidth = dataRange / 20;

    // Calculate extended range to ensure all bins have equal width
    // Start from a value that when divided into 20 bins, covers all data
    const minBin = Math.floor(extent[0] / binWidth) * binWidth;
    const maxBin = minBin + (20 * binWidth);

    // Create custom thresholds for exactly 20 equal-width bins
    const thresholds = d3.range(minBin, maxBin + binWidth, binWidth).slice(0, 21); // 21 edges create 20 bins

    const binGenerator = d3.bin()
        .domain([minBin, maxBin])
        .thresholds(thresholds)
        .value(d => d.value);

    const bins = binGenerator(values);

    // Sort countries within each bin by value
    bins.forEach(bin => {
        bin.sort((a, b) => a.value - b.value);
    });

    // Scales - use extended range to show all equal-width bins
    const xScale = d3.scaleLinear()
        .domain([minBin, maxBin])
        .range([0, width]);

    const yScale = d3.scaleLinear()
        .domain([0, d3.max(bins, d => d.length)])
        .range([height, 0])
        .nice();

    // Responsive tick count
    const tickCount = isSmallScreen ? 4 : (isMediumScreen ? 5 : 6);

    // Grid lines
    svg.append('g')
        .attr('class', 'grid')
        .attr('opacity', 0.2)
        .call(d3.axisLeft(yScale)
            .ticks(tickCount)
            .tickSize(-width)
            .tickFormat(''));

    // Axes
    const xAxisGroup = svg.append('g')
        .attr('class', 'axis x-axis')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale)
            .ticks(tickCount)
            .tickFormat(formatAxisTick));

    const yAxisGroup = svg.append('g')
        .attr('class', 'axis y-axis')
        .call(d3.axisLeft(yScale)
            .ticks(tickCount)
            .tickFormat(formatAxisTick));

    // Axis labels with responsive sizing
    const labelFontSize = isSmallScreen ? '14px' : (isMediumScreen ? '16px' : '18px');
    const xLabelY = isSmallScreen ? height + 45 : height + 50;
    const yLabelY = isSmallScreen ? -35 : -45;

    // X axis label with tooltip (for the index being displayed)
    svg.append('text')
        .attr('class', 'axis-label hoverable')
        .attr('text-anchor', 'middle')
        .attr('x', width / 2)
        .attr('y', xLabelY)
        .style('fill', getComputedStyle(document.body).getPropertyValue('--text-primary'))
        .style('font-size', labelFontSize)
        .style('font-weight', '500')
        .text(label)
        .on('mouseenter', function(event) {
            showAxisLabelTooltip(event, index);
        })
        .on('mousemove', function(event) {
            showAxisLabelTooltip(event, index);
        })
        .on('mouseleave', function() {
            hideAxisLabelTooltip();
        });

    // Y axis label (Frequency - no tooltip needed)
    svg.append('text')
        .attr('class', 'axis-label')
        .attr('text-anchor', 'middle')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', yLabelY)
        .style('fill', getComputedStyle(document.body).getPropertyValue('--text-primary'))
        .style('font-size', labelFontSize)
        .style('font-weight', '500')
        .text('Frequency');

    // Tooltip with hover capability
    const tooltip = d3.select('body').append('div')
        .attr('class', 'tooltip histogram-tooltip')
        .style('opacity', 0)
        .style('pointer-events', 'none'); // Initially not interactable

    let tooltipTimeout;

    // Add tooltip hover events
    tooltip
        .on('mouseenter', function() {
            clearTimeout(tooltipTimeout);
            tooltip.style('opacity', 1);
        })
        .on('mouseleave', function() {
            tooltip.transition()
                .duration(300)
                .style('opacity', 0)
                .on('end', function() {
                    tooltip.style('pointer-events', 'none');
                });
        });

    // Always color by continent
    const colorByContinent = true;

    // Continent color scale - high contrast palette for clear distinction
    const continentColors = {
        'Africa': '#f97316',        // Orange
        'Asia': '#a855f7',          // Vivid purple
        'Europe': '#2563eb',        // Royal blue
        'North America': '#22c55e', // Vivid green
        'South America': '#ef4444', // Red
        'Oceania': '#eab308',       // Golden yellow
        'Antarctica': '#64748b'     // Slate gray
    };

    // Use persisted hidden continents from state, or create new Set
    if (!state.hiddenContinents[plotNum]) {
        state.hiddenContinents[plotNum] = new Set();
    }
    const hiddenContinents = state.hiddenContinents[plotNum];

    // Prepare data for stacked bars if coloring by continent
    if (colorByContinent) {
        bins.forEach(bin => {
            // Count countries by continent in this bin (use English for color keys)
            const continentCounts = {};
            bin.forEach(item => {
                const continent = state.continentMap[item.country_code];
                if (continent) {
                    continentCounts[continent] = (continentCounts[continent] || 0) + 1;
                }
            });

            // Sort continents by count (most frequent first, will be drawn from bottom)
            const sortedContinents = Object.entries(continentCounts)
                .sort((a, b) => b[1] - a[1]) // Sort descending
                .map(([continent, count]) => ({ continent, count }));

            // Add continentData as a property to the bin array
            bin.continentData = sortedContinents;
        });
    }

    // Draw bars (stacked if coloring by continent, single otherwise)
    const barGroups = svg.selectAll('.bar-group')
        .data(bins)
        .enter()
        .append('g')
        .attr('class', 'bar-group')
        .style('cursor', 'pointer');

    // Store bars reference for legend interaction
    let bars;

    if (colorByContinent) {
        // Draw stacked bars
        barGroups.each(function(binData, i) {
            const group = d3.select(this);
            let cumulativeHeight = 0;

            binData.continentData.forEach((continentInfo, j) => {
                const segmentHeight = height - yScale(continentInfo.count);

                group.append('rect')
                    .attr('class', 'bar-segment')
                    .attr('data-continent', continentInfo.continent)
                    .attr('x', xScale(binData.x0) + 1)
                    .attr('width', Math.max(0, xScale(binData.x1) - xScale(binData.x0) - 2))
                    .attr('y', height - cumulativeHeight - segmentHeight)
                    .attr('height', segmentHeight)
                    .style('fill', continentColors[continentInfo.continent])
                    .style('opacity', 0.7);

                cumulativeHeight += segmentHeight;
            });
        });

        bars = barGroups;
    } else {
        // Draw single-color bars
        bars = barGroups.append('rect')
            .attr('x', d => xScale(d.x0) + 1)
            .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 2))
            .attr('y', d => yScale(d.length))
            .attr('height', d => height - yScale(d.length))
            .style('fill', '#2563eb')
            .style('opacity', 0.7);
    }

    // Add interaction to bar groups
    barGroups
        .on('mouseover', function(event, d) {
            clearTimeout(tooltipTimeout);

            // Highlight all segments in this bar
            if (colorByContinent) {
                d3.select(this).selectAll('rect')
                    .transition()
                    .duration(200)
                    .style('opacity', 1);
            } else {
                d3.select(this).select('rect')
                    .transition()
                    .duration(200)
                    .style('opacity', 1);
            }

            tooltip
                .style('pointer-events', 'auto')
                .transition()
                .duration(200)
                .style('opacity', 1);

            // Filter data by hidden continents
    const visibleData = d.filter(item => {
        const continent = state.continentMap[item.country_code];
        return !hiddenContinents.has(continent);
    });

    // Create list of countries in this bin, ordered by value
    const countriesHtml = visibleData.map(item => {
        const countryName = getCountryLabel(item.country_code);
        const continent = state.continentMap[item.country_code];
        const color = colorByContinent && continent ? continentColors[continent] : '#2563eb';
        const yearText = year === 'all' ? ` (${item.year})` : (year === 'averaged' ? ' (avg)' : '');
        return `<div style="color: ${color}; margin: 2px 0;">${countryName}: ${formatTooltipValue(item.value)}${yearText}</div>`;
    }).join('');

            const tooltipContent = `<strong>Range: ${formatTooltipValue(d.x0)} – ${formatTooltipValue(d.x1)}</strong><br/><span style="color: var(--text-secondary); font-size: 0.8125rem;">Count: ${visibleData.length}</span><br/><div style="max-height: 200px; overflow-y: auto; margin-top: 0.5rem;">${countriesHtml}</div>`;

            tooltip.html(tooltipContent)
                .style('left', (event.clientX + 10) + 'px')
                .style('top', (event.clientY - 28) + 'px');
        })
        .on('mouseout', function() {
            // Reset opacity for all segments
            if (colorByContinent) {
                d3.select(this).selectAll('rect')
                    .transition()
                    .duration(200)
                    .style('opacity', 0.7);
            } else {
                d3.select(this).select('rect')
                    .transition()
                    .duration(200)
                    .style('opacity', 0.7);
            }

            // Delay hiding tooltip to allow moving mouse to it
            tooltipTimeout = setTimeout(() => {
                tooltip.transition()
                    .duration(300)
                    .style('opacity', 0)
                    .on('end', function() {
                        tooltip.style('pointer-events', 'none');
                    });
            }, 100);
        });

    // Calculate legend offset to center it over the chart area (not the plot div)
    const legendOffset = (margin.left - margin.right) / 2;

    // Always create legend placeholder to reserve space
    const legendPlaceholder = d3.select(`#plot${plotNum}`)
        .append('div')
        .attr('class', 'legend-placeholder')
        .style('left', `calc(50% + ${legendOffset}px)`);

    // Add continent legend if coloring by continent
    if (colorByContinent) {
        // Get unique continents from the data (use English for keys/colors)
        const continentsInData = [...new Set(values.map(v => state.continentMap[v.country_code]).filter(c => c))].sort();

        // Apply initial visibility based on persisted state
        barGroups.each(function(binData) {
            const group = d3.select(this);
            let cumulativeHeight = 0;

            binData.continentData.forEach((continentInfo) => {
                const segment = group.select(`rect[data-continent="${continentInfo.continent}"]`);

                if (hiddenContinents.has(continentInfo.continent)) {
                    segment.attr('height', 0).attr('y', height);
                } else {
                    const segmentHeight = height - yScale(continentInfo.count);
                    segment.attr('y', height - cumulativeHeight - segmentHeight).attr('height', segmentHeight);
                    cumulativeHeight += segmentHeight;
                }
            });
        });

        const legend = d3.select(`#plot${plotNum}`)
            .append('div')
            .attr('class', 'continent-legend')
            .style('left', `calc(50% + ${legendOffset}px)`);

        continentsInData.forEach(continentEn => {
            const isHidden = hiddenContinents.has(continentEn);
            const item = legend.append('div')
                .attr('class', 'legend-item' + (isHidden ? ' legend-item-hidden' : ''))
                .style('cursor', 'pointer')
                .style('opacity', isHidden ? 0.3 : 1)
                .on('click', function() {
                    // Toggle continent visibility
                    if (hiddenContinents.has(continentEn)) {
                        hiddenContinents.delete(continentEn);
                        d3.select(this)
                            .style('opacity', null)
                            .classed('legend-item-hidden', false);
                    } else {
                        hiddenContinents.add(continentEn);
                        d3.select(this)
                            .style('opacity', 0.3)
                            .classed('legend-item-hidden', true);
                    }

                    // Update stacked bars
                    barGroups.each(function(binData) {
                        const group = d3.select(this);
                        let cumulativeHeight = 0;

                        // Update each segment
                        binData.continentData.forEach((continentInfo, j) => {
                            const segment = group.select(`rect[data-continent="${continentInfo.continent}"]`);

                            if (hiddenContinents.has(continentInfo.continent)) {
                                // Hide this segment
                                segment
                                    .transition()
                                    .duration(300)
                                    .attr('height', 0)
                                    .attr('y', height);
                            } else {
                                // Show and position this segment
                                const segmentHeight = height - yScale(continentInfo.count);
                                segment
                                    .transition()
                                    .duration(300)
                                    .attr('y', height - cumulativeHeight - segmentHeight)
                                    .attr('height', segmentHeight);

                                cumulativeHeight += segmentHeight;
                            }
                        });
                    });
                });

        item.append('div')
            .attr('class', 'legend-color')
            .style('background-color', continentColors[continentEn]);

        const continentDisplay = continentEn;
        item.append('span')
            .attr('class', 'legend-label')
            .text(continentDisplay);
    });
}

    // Add point count badge (bottom-right corner)
    d3.select(`#plot${plotNum}`)
        .append('div')
        .attr('class', 'plot-point-count')
        .text(`Points: ${data.length.toLocaleString('fr-FR')}`);
}

// Close all open dropdowns (multiselects and searchable selects)
function closeAllDropdowns() {
    // Close all multiselect dropdowns
    document.querySelectorAll('.multiselect-container.open').forEach(container => {
        container.classList.remove('open');
        const dropdown = container.querySelector('.multiselect-dropdown');
        if (dropdown) dropdown.classList.remove('open');
    });

    // Close all searchable select dropdowns
    document.querySelectorAll('.searchable-select.open').forEach(container => {
        container.classList.remove('open');
    });
}

// Initialize hamburger menu
function initializeHamburgerMenu() {
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const navTabs = document.getElementById('navTabs');
    const body = document.body;

    if (!hamburgerBtn || !navTabs) {
        console.log('Hamburger menu not found (desktop view)');
        return;
    }

    // Toggle menu on hamburger button click
    hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Close all dropdowns when opening hamburger menu
        if (!hamburgerBtn.classList.contains('active')) {
            closeAllDropdowns();
        }

        hamburgerBtn.classList.toggle('active');
        navTabs.classList.toggle('active');
        body.classList.toggle('menu-open');
    });

    // Close menu when clicking on overlay
    body.addEventListener('click', (e) => {
        if (body.classList.contains('menu-open') &&
            !navTabs.contains(e.target) &&
            !hamburgerBtn.contains(e.target)) {
            hamburgerBtn.classList.remove('active');
            navTabs.classList.remove('active');
            body.classList.remove('menu-open');
        }
    });

    // Close menu when clicking on a tab
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // On mobile, close the menu after selecting a tab
            if (window.innerWidth <= 1200) {
                hamburgerBtn.classList.remove('active');
                navTabs.classList.remove('active');
                body.classList.remove('menu-open');
            }
        });
    });

    // Close menu on window resize if it's open and we're back to desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth > 1200 && body.classList.contains('menu-open')) {
            hamburgerBtn.classList.remove('active');
            navTabs.classList.remove('active');
            body.classList.remove('menu-open');
        }
    });
}

// Switch to a specific tab
function switchToTab(targetTab) {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // Remove active class from all tabs
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    // Add active class to target tab
    const targetButton = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
    const targetContent = document.getElementById(targetTab);

    if (targetButton && targetContent) {
        targetButton.classList.add('active');
        targetContent.classList.add('active');

        // Save to localStorage
        localStorage.setItem('activeTab', targetTab);

        // Initialize tabs when first opened
        if (targetTab === 'raw-data') {
            initializeRawDataTab();
        } else if (targetTab === 'map') {
            initializeMapTab();
        } else if (targetTab === 'timeline') {
            initializeTimelineTab();
        } else if (targetTab === 'compare') {
            // When returning to Compare, ensure plots render after being hidden
            requestAnimationFrame(() => {
                updatePlot(1);
                if (isSecondPlotActive()) {
                    updatePlot(2);
                }
                ['1', '2'].forEach(num => {
                    const slider = document.getElementById(`yearSlider${num}`);
                    const input = document.getElementById(`yearInput${num}`);
                    if (slider && input) updateYearInputPosition(slider, input);
                });
            });
        }
    }
}

// Initialize tabs
function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');

    // Add click listeners to tab buttons
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            switchToTab(button.dataset.tab);
        });
    });
}

// Restore saved tab (call after data is loaded)
function restoreSavedTab() {
    let savedTab = localStorage.getItem('activeTab');
    // Maintain compatibility with previous "overview" tab key
    if (savedTab === 'overview') {
        savedTab = 'compare';
        localStorage.setItem('activeTab', savedTab);
    }
    // Maintain compatibility with previous \"countries\" tab key
    if (savedTab === 'countries') {
        savedTab = 'timeline';
        localStorage.setItem('activeTab', savedTab);
    }
    if (savedTab && document.getElementById(savedTab)) {
        switchToTab(savedTab);
    }
}

// Initialize theme toggle
function initializeThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    if (!themeToggle) {
        console.error('Theme toggle button not found');
        return;
    }

    themeToggle.addEventListener('click', () => {
        console.log('Theme toggle clicked');
        state.currentTheme = state.currentTheme === 'dark' ? 'light' : 'dark';
        document.body.className = state.currentTheme + '-mode';
        localStorage.setItem('theme', state.currentTheme);
        console.log('Theme changed to:', state.currentTheme);
        updateThemeIcon();

        // Refresh plots and map to update colors
        updatePlot(1);
        if (isSecondPlotActive()) {
            updatePlot(2);
        }
        if (mapState.initialized) {
            renderMap();
        }
        if (timelineTabState.initialized && timelineTabState.data.length > 0) {
            renderTimelinePlots();
        }
    });
}

function updateThemeIcon() {
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) {
        if (state.currentTheme === 'dark') {
            // Sun icon for dark mode (click to switch to light)
            themeIcon.innerHTML = `
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            `;
        } else {
            // Moon icon for light mode (click to switch to dark)
            themeIcon.innerHTML = `
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            `;
        }
    }
}

// ============================================
// DOWNLOAD DATA FUNCTIONALITY
// ============================================

function initializeDownloadButton() {
    const downloadBtn = document.getElementById('downloadDataBtn');
    if (!downloadBtn) {
        console.error('Download button not found');
        return;
    }

    downloadBtn.addEventListener('click', async () => {
        downloadBtn.disabled = true;
        try {
            await downloadAllDataAsCSV();
        } finally {
            downloadBtn.disabled = false;
        }
    });
}

async function downloadAllDataAsCSV() {
    try {
        // First, get all available years
        const yearsResponse = await fetch('/api/raw-data/years');
        if (!yearsResponse.ok) {
            throw new Error('Failed to fetch available years');
        }
        const years = await yearsResponse.json();

        if (years.length === 0) {
            console.error('No data available to download');
            return;
        }

        // Fetch data for all years in parallel (in batches to avoid overwhelming the server)
        const batchSize = 10;
        let allData = [];
        let columns = null;

        for (let i = 0; i < years.length; i += batchSize) {
            const batch = years.slice(i, i + batchSize);
            const batchPromises = batch.map(year =>
                fetch(`/api/raw-data?year=${year}`).then(r => r.json())
            );
            const batchResults = await Promise.all(batchPromises);

            for (const data of batchResults) {
                if (data.length > 0) {
                    if (!columns) {
                        // Get columns from first non-empty result, excluding display fields
                        columns = Object.keys(data[0]).filter(col =>
                            col !== 'country_display_name' && col !== 'flag'
                        );
                    }
                    allData.push(...data);
                }
            }
        }

        if (allData.length === 0 || !columns) {
            console.error('No data available to download');
            return;
        }

        // Match all_data view ordering: country_code asc, then year asc
        allData.sort((a, b) => {
            const codeA = a.country_code || '';
            const codeB = b.country_code || '';
            const codeCompare = codeA.localeCompare(codeB);
            if (codeCompare !== 0) return codeCompare;

            const yearA = Number.isFinite(Number(a.year)) ? Number(a.year) : Number.POSITIVE_INFINITY;
            const yearB = Number.isFinite(Number(b.year)) ? Number(b.year) : Number.POSITIVE_INFINITY;
            return yearA - yearB;
        });

        // Reorder columns to have country_code, country_name, continent, year first
        const priorityColumns = ['country_code', 'country_name', 'continent', 'year'];
        const orderedColumns = [
            ...priorityColumns.filter(col => columns.includes(col)),
            ...columns.filter(col => !priorityColumns.includes(col))
        ];

        // Convert to CSV
        const csvRows = [];

        // Header row
        csvRows.push(orderedColumns.join(','));

        // Data rows
        for (const row of allData) {
            const values = orderedColumns.map(col => {
                let value = row[col];
                if (value === null || value === undefined) {
                    return '';
                }
                // Escape values containing commas, quotes, or newlines
                value = String(value);
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    value = '"' + value.replace(/"/g, '""') + '"';
                }
                return value;
            });
            csvRows.push(values.join(','));
        }

        const csvContent = csvRows.join('\n');

        // Create and trigger download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'dataoftheworld.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log(`Downloaded ${allData.length} rows of data`);
    } catch (error) {
        console.error('Error downloading data:', error);
    }
}

// ============================================
// RAW DATA TAB FUNCTIONALITY
// ============================================

// Raw data state
const rawDataState = {
    data: [],
    filteredData: [],
    availableYears: [],
    yearRange: null, // Year range for selected indexes (trimmed based on data availability)
    currentYear: null,
    sortColumn: 'country_name',
    sortDirection: 'asc',
    selectedContinents: new Set(),
    selectedCountries: new Set(),
    selectedIndexes: new Set(),
    allContinents: [],
    allCountries: [],
    columnOrder: [], // Order of columns (will be initialized)
    draggedColumn: null, // Currently dragged column
    initialized: false,
    isLoading: false,
    collapsedCountryContinents: new Set() // Track collapsed continent groups in country multiselect
};

// Index columns configuration (loaded from API)
let indexColumns = [];

function measureCountryOptionWidth(label) {
    const measurer = document.createElement('div');
    measurer.style.cssText = [
        'position:absolute',
        'visibility:hidden',
        'pointer-events:none',
        'display:inline-flex',
        'align-items:center',
        'gap:10px',
        'padding:8px 12px',
        'white-space:nowrap',
        'overflow:visible',
        'width:auto',
        'min-width:0',
        'font-size:0.875rem',
        'line-height:1.4'
    ].join(';');

    const checkbox = document.createElement('div');
    checkbox.style.cssText = 'width:16px;height:16px;flex:0 0 16px;';

    const textSpan = document.createElement('span');
    textSpan.textContent = label;
    textSpan.style.cssText = 'white-space:nowrap;overflow:visible;text-overflow:clip;';

    measurer.appendChild(checkbox);
    measurer.appendChild(textSpan);
    document.body.appendChild(measurer);

    const width = measurer.getBoundingClientRect().width;
    measurer.remove();
    return width;
}

// Measure the longest country label and set dropdown width so expanding doesn't resize layout
function updateCountryDropdownWidth() {
    const dropdown = document.getElementById('countryDropdown');
    const optionsContainer = document.getElementById('countryOptions');
    if (!dropdown || !optionsContainer || !rawDataState.allCountries.length) return;

    const groupedCountries = getCountriesByContinent();
    if (!groupedCountries.length) return;

    const minColumnWidth = 220;
    const gap = 8; // 0.5rem gap
    const containerPadding = 16; // total horizontal padding for #countryOptions
    const maxWidth = Math.min(window.innerWidth * 0.95, 1200);

    // Track widths by the three grid columns (index 0..2 based on rendering order)
    const widthsByColumn = [minColumnWidth, minColumnWidth, minColumnWidth];
    const headerBuffer = 48; // space for continent title and action buttons

    groupedCountries.forEach((group, idx) => {
        const longest = group.countries.reduce((max, country) => {
            return country.label.length > max.length ? country.label : max;
        }, '');
        const labelWidth = longest ? measureCountryOptionWidth(longest) + headerBuffer : minColumnWidth;
        const col = idx % 3;
        widthsByColumn[col] = Math.max(widthsByColumn[col], Math.min(labelWidth, maxWidth));
    });

    // Apply exact column widths to the grid (3 columns, no extra space)
    const columnTemplate = widthsByColumn.map(w => `${w}px`).join(' ');
    optionsContainer.style.gridTemplateColumns = columnTemplate;

    const columns = Math.min(3, groupedCountries.length);
    const baseWidth = widthsByColumn.slice(0, columns).reduce((sum, w) => sum + w, 0);
    const computedWidth = baseWidth + gap * Math.max(0, columns - 1) + containerPadding;
    const minWidth = minColumnWidth * columns + gap * Math.max(0, columns - 1) + containerPadding;
    const finalWidth = Math.min(Math.max(computedWidth, minWidth), maxWidth);

    dropdown.style.width = `${finalWidth}px`;
    dropdown.style.minWidth = `${finalWidth}px`;
}

// Measure and set Timeline tab dropdown width with fixed 3-column layout
function updateTimelineDropdownWidth() {
    const dropdown = document.getElementById('timelineCountryDropdown');
    const optionsContainer = document.getElementById('timelineCountryOptions');
    if (!dropdown || !optionsContainer || !timelineTabState.allCountries.length) return;

    const groupedCountries = getTimelineTabByContinent();
    if (!groupedCountries.length) return;

    const minColumnWidth = 220;
    const gap = 8; // 0.5rem gap
    const containerPadding = 16; // total horizontal padding for #timelineCountryOptions
    const maxWidth = Math.min(window.innerWidth * 0.95, 1200);

    // Track widths by the three grid columns (index 0..2 based on rendering order)
    const widthsByColumn = [minColumnWidth, minColumnWidth, minColumnWidth];
    const headerBuffer = 48; // space for continent title and action buttons

    groupedCountries.forEach((group, idx) => {
        const longest = group.countries.reduce((max, country) => {
            return country.label.length > max.length ? country.label : max;
        }, '');
        const labelWidth = longest ? measureCountryOptionWidth(longest) + headerBuffer : minColumnWidth;
        const col = idx % 3;
        widthsByColumn[col] = Math.max(widthsByColumn[col], Math.min(labelWidth, maxWidth));
    });

    const columns = Math.min(3, groupedCountries.length);
    const columnTemplate = widthsByColumn.slice(0, columns).map(w => `${w}px`).join(' ');
    optionsContainer.style.gridTemplateColumns = columnTemplate;

    const baseWidth = widthsByColumn.slice(0, columns).reduce((sum, w) => sum + w, 0);
    const computedWidth = baseWidth + gap * Math.max(0, columns - 1) + containerPadding;
    const minWidth = minColumnWidth * columns + gap * Math.max(0, columns - 1) + containerPadding;
    const finalWidth = Math.min(Math.max(computedWidth, minWidth), maxWidth);

    dropdown.style.width = `${finalWidth}px`;
    dropdown.style.minWidth = `${finalWidth}px`;
}

// Initialize Raw Data tab
async function initializeRawDataTab() {
    if (rawDataState.initialized) return;

    console.log('Initializing Raw Data tab...');

    // Load available years
    await loadRawDataYears();

    // Set up year slider (initial setup with full range)
    setupRawDataYearSlider();

    // Initialize multiselect data (sets default selected indexes)
    initializeMultiselectData();

    // Load year range for initially selected indexes and update slider
    await loadRawDataYearRange();
    await updateRawDataYearSlider();

    // Set up multiselect widgets
    setupContinentMultiselect();
    setupCountryMultiselect();
    setupIndexesMultiselect();
    window.addEventListener('resize', updateCountryDropdownWidth);

    // Set up event listeners
    setupRawDataEventListeners();

    // Build table headers
    buildRawDataTableHeaders();
    ensureRawDataDivider();
    updateRawDataStickyDivider();
    updateRawDataNameColumnWidth();

    // Mark as initialized
    rawDataState.initialized = true;

    // Load initial data
    await loadRawData();

    console.log('Raw Data tab initialized');
}

// Initialize multiselect data from countries
function initializeMultiselectData() {
    // Get unique continents
    rawDataState.allContinents = [...new Set(state.countries.map(c => c.continent))].filter(c => c).sort();

    // Get all countries sorted alphabetically by name (not by flag)
    rawDataState.allCountries = state.countries
        .map(c => ({
            code: c.country_code,
            name: (c.country_name || '').trim(),
            label: buildCountryLabel(c.country_name, c.flag),
            continent: c.continent
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    // By default, all continents, countries, and indexes are selected
    rawDataState.selectedContinents = new Set(rawDataState.allContinents);
    rawDataState.selectedCountries = new Set(rawDataState.allCountries.map(c => c.code));
    rawDataState.selectedIndexes = new Set(indexColumns.map(c => c.id));

    // By default, all continent groups are collapsed in the country multiselect
    rawDataState.collapsedCountryContinents = new Set(rawDataState.allContinents);

    // Initialize column order: fixed columns + index columns
    rawDataState.columnOrder = [
        'rank',
        'country_name',
        'continent',
        ...indexColumns.map(c => c.id)
    ];
}

// Load available years from API
async function loadRawDataYears() {
    try {
        const response = await fetch('/api/raw-data/years');
        rawDataState.availableYears = await response.json();
        console.log('Raw data years loaded:', rawDataState.availableYears.length);
    } catch (error) {
        console.error('Error loading raw data years:', error);
        rawDataState.availableYears = [];
    }
}

// Load year range for selected indexes (for Raw Data tab)
async function loadRawDataYearRange() {
    const selectedIndexes = Array.from(rawDataState.selectedIndexes);
    if (selectedIndexes.length === 0) {
        rawDataState.yearRange = null;
        return null;
    }

    try {
        const indexesParam = selectedIndexes.join(',');
        const response = await fetch(`/api/years?indexes=${encodeURIComponent(indexesParam)}`);
        const yearRange = await response.json();
        console.log('Raw data year range loaded for indexes:', selectedIndexes, yearRange);
        rawDataState.yearRange = yearRange;
        return yearRange;
    } catch (error) {
        console.error('Error loading raw data year range:', error);
        rawDataState.yearRange = null;
        return null;
    }
}

// Update raw data year slider based on selected indexes' data availability
async function updateRawDataYearSlider() {
    const slider = document.getElementById('rawDataYearSlider');
    const yearInput = document.getElementById('rawDataYearInput');
    const minEl = document.getElementById('rawDataYearMin');
    const maxEl = document.getElementById('rawDataYearMax');

    if (!slider || rawDataState.availableYears.length === 0) return;

    // Get base range from all available years
    const baseMinYear = Math.min(...rawDataState.availableYears);
    const baseMaxYear = Math.max(...rawDataState.availableYears);

    // Use index-specific range if available, otherwise use base range
    let minYear = baseMinYear;
    let maxYear = baseMaxYear;

    if (rawDataState.yearRange && rawDataState.yearRange.min_year && rawDataState.yearRange.max_year) {
        minYear = rawDataState.yearRange.min_year;
        maxYear = rawDataState.yearRange.max_year;
    }

    // Clamp current value to new range
    const currentValue = parseInt(slider.value || maxYear, 10);
    const newValue = isNaN(currentValue) ? maxYear : Math.min(Math.max(currentValue, minYear), maxYear);

    slider.min = minYear;
    slider.max = maxYear;
    slider.value = newValue;
    rawDataState.currentYear = newValue;

    if (minEl) minEl.textContent = minYear;
    if (maxEl) maxEl.textContent = maxYear;
    if (yearInput) {
        yearInput.value = newValue;
        yearInput.min = minYear;
        yearInput.max = maxYear;
    }

    console.log(`Raw data year slider range: ${minYear}-${maxYear}, value: ${newValue}`);
}

// Set up year slider
function setupRawDataYearSlider() {
    const slider = document.getElementById('rawDataYearSlider');
    const yearInput = document.getElementById('rawDataYearInput');
    const minEl = document.getElementById('rawDataYearMin');
    const maxEl = document.getElementById('rawDataYearMax');

    if (!slider || rawDataState.availableYears.length === 0) return;

    const minYear = Math.min(...rawDataState.availableYears);
    const maxYear = Math.max(...rawDataState.availableYears);

    slider.min = minYear;
    slider.max = maxYear;

    // Default to 2023 when available, otherwise fallback to newest year
    const defaultYear = rawDataState.availableYears.includes(2023)
        ? 2023
        : maxYear;
    slider.value = defaultYear;
    rawDataState.currentYear = defaultYear;

    if (minEl) minEl.textContent = minYear;
    if (maxEl) maxEl.textContent = maxYear;
    if (yearInput) {
        yearInput.value = defaultYear;
        yearInput.min = minYear;
        yearInput.max = maxYear;
        // Initial positioning
        setTimeout(() => updateYearInputPosition(slider, yearInput), 0);
    }
}

// ============================================
// MULTISELECT WIDGET FUNCTIONS
// ============================================

// Setup continent multiselect
function setupContinentMultiselect() {
    const container = document.getElementById('continentMultiselect');
    const searchInput = document.getElementById('continentSearch');
    const dropdown = document.getElementById('continentDropdown');
    const optionsContainer = document.getElementById('continentOptions');
    const selectAllBtn = document.getElementById('continentSelectAll');
    const unselectAllBtn = document.getElementById('continentUnselectAll');

    if (!container) return;

    // Populate options
    renderContinentOptions();

    // Click on input wrapper toggles dropdown
    container.querySelector('.multiselect-input-wrapper').addEventListener('click', () => {
        const isOpen = container.classList.contains('open');
        if (isOpen) {
            container.classList.remove('open');
            dropdown.classList.remove('open');
        } else {
            container.classList.add('open');
            dropdown.classList.add('open');
            searchInput.focus();
        }
    });

    // Search filtering
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        filterMultiselectOptions('continent', searchTerm);
    });

    // Select all
    selectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rawDataState.selectedContinents = new Set(rawDataState.allContinents);
        renderContinentOptions();
        renderContinentTags();
        applyRawDataFilters();
    });

    // Unselect all
    unselectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rawDataState.selectedContinents = new Set();
        renderContinentOptions();
        renderContinentTags();
        applyRawDataFilters();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            container.classList.remove('open');
            dropdown.classList.remove('open');
            searchInput.value = '';
            filterMultiselectOptions('continent', '');
        }
    });

    // Initial render
    renderContinentTags();
}

// Setup country multiselect
function setupCountryMultiselect() {
    const container = document.getElementById('countryMultiselect');
    const searchInput = document.getElementById('countrySearch');
    const dropdown = document.getElementById('countryDropdown');
    const optionsContainer = document.getElementById('countryOptions');
    const selectAllBtn = document.getElementById('countrySelectAll');
    const unselectAllBtn = document.getElementById('countryUnselectAll');

    if (!container) return;

    // Populate options
    renderCountryOptions();

    // Click on input wrapper toggles dropdown
    container.querySelector('.multiselect-input-wrapper').addEventListener('click', () => {
        const isOpen = container.classList.contains('open');
        if (isOpen) {
            container.classList.remove('open');
            dropdown.classList.remove('open');
        } else {
            container.classList.add('open');
            dropdown.classList.add('open');
            searchInput.focus();
        }
    });

    // Search filtering
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        filterMultiselectOptions('country', searchTerm);
    });

    // Select all (visible/filtered items)
    selectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const searchTerm = searchInput.value.toLowerCase();
        rawDataState.allCountries.forEach(country => {
            const name = country.name;
            if (!searchTerm || name.toLowerCase().includes(searchTerm) || country.code.toLowerCase().includes(searchTerm)) {
                rawDataState.selectedCountries.add(country.code);
            }
        });
        renderCountryOptions();
        renderCountryTags();
        applyRawDataFilters();
    });

    // Unselect all
    unselectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rawDataState.selectedCountries = new Set();
        renderCountryOptions();
        renderCountryTags();
        applyRawDataFilters();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            container.classList.remove('open');
            dropdown.classList.remove('open');
            searchInput.value = '';
            filterMultiselectOptions('country', '');
            updateCountryDropdownWidth();
        }
    });

    // Initial render
    renderCountryTags();
}

// Setup indexes multiselect
function setupIndexesMultiselect() {
    const container = document.getElementById('indexesMultiselect');
    const searchInput = document.getElementById('indexesSearch');
    const dropdown = document.getElementById('indexesDropdown');
    const optionsContainer = document.getElementById('indexesOptions');
    const selectAllBtn = document.getElementById('indexesSelectAll');
    const unselectAllBtn = document.getElementById('indexesUnselectAll');

    if (!container) return;

    // Populate options
    renderIndexesOptions();

    // Click on input wrapper toggles dropdown
    container.querySelector('.multiselect-input-wrapper').addEventListener('click', () => {
        const isOpen = container.classList.contains('open');
        if (isOpen) {
            container.classList.remove('open');
            dropdown.classList.remove('open');
        } else {
            container.classList.add('open');
            dropdown.classList.add('open');
            searchInput.focus();
        }
    });

    // Search filtering
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        filterMultiselectOptions('indexes', searchTerm);
    });

    // Select all
    selectAllBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        rawDataState.selectedIndexes = new Set(indexColumns.map(c => c.id));
        renderIndexesOptions();
        renderIndexesTags();
        buildRawDataTableHeaders();
        renderRawDataTable();
        // Update year range for selected indexes
        await loadRawDataYearRange();
        await updateRawDataYearSlider();
    });

    // Unselect all
    unselectAllBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        rawDataState.selectedIndexes = new Set();
        renderIndexesOptions();
        renderIndexesTags();
        buildRawDataTableHeaders();
        renderRawDataTable();
        // Update year range (resets to full range when no indexes selected)
        await loadRawDataYearRange();
        await updateRawDataYearSlider();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            container.classList.remove('open');
            dropdown.classList.remove('open');
            searchInput.value = '';
            filterMultiselectOptions('indexes', '');
        }
    });

    // Initial render
    renderIndexesTags();
}

// Render indexes options grouped by category in two-column layout
function renderIndexesOptions() {
    const optionsContainer = document.getElementById('indexesOptions');
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';

    // Get indexes grouped by category
    const groupedIndexes = getIndexesByCategory();

    groupedIndexes.forEach((group) => {
        // Get IDs for this category
        const categoryIndexIds = group.indexes.map(idx => idx.id);
        const selectedCount = categoryIndexIds.filter(id => rawDataState.selectedIndexes.has(id)).length;

        // Determine button states
        const allSelected = selectedCount === group.indexes.length;
        const noneSelected = selectedCount === 0;

        // Create a wrapper for the entire category group (header + indexes)
        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'multiselect-index-group';
        groupWrapper.dataset.category = group.category;

        // Create category header with select/clear buttons
        const header = document.createElement('div');
        header.className = 'multiselect-category-header';
        header.innerHTML = `
            <span class="multiselect-category-title">${group.category} <span class="multiselect-category-count">(${selectedCount}/${group.indexes.length})</span></span>
            <div class="multiselect-category-actions">
                <button type="button" class="multiselect-category-btn multiselect-category-select ${allSelected ? 'inactive' : ''}" title="Select all ${group.category}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
                </button>
                <button type="button" class="multiselect-category-btn multiselect-category-clear ${noneSelected ? 'inactive' : ''}" title="Clear all ${group.category}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                </button>
            </div>
        `;

        // Add event listeners for category buttons
        const selectBtn = header.querySelector('.multiselect-category-select');
        const clearBtn = header.querySelector('.multiselect-category-clear');

        selectBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            categoryIndexIds.forEach(id => rawDataState.selectedIndexes.add(id));
            renderIndexesOptions();
            renderIndexesTags();
            buildRawDataTableHeaders();
            renderRawDataTable();
            // Update year range for selected indexes
            await loadRawDataYearRange();
            await updateRawDataYearSlider();
        });

        clearBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            categoryIndexIds.forEach(id => rawDataState.selectedIndexes.delete(id));
            renderIndexesOptions();
            renderIndexesTags();
            buildRawDataTableHeaders();
            renderRawDataTable();
            // Update year range for selected indexes
            await loadRawDataYearRange();
            await updateRawDataYearSlider();
        });

        groupWrapper.appendChild(header);

        // Create container for indexes in this category
        const indexList = document.createElement('div');
        indexList.className = 'multiselect-index-list';

        // Create options for each index in the category
        group.indexes.forEach(indexData => {
            const label = getIndexLabel(indexData) || indexData.id;
            const isSelected = rawDataState.selectedIndexes.has(indexData.id);

            const option = document.createElement('div');
            option.className = `multiselect-option ${isSelected ? 'selected' : ''}`;
            option.dataset.value = indexData.id;
            option.dataset.category = group.category;
            option.innerHTML = `
                <input type="checkbox" class="multiselect-checkbox" ${isSelected ? 'checked' : ''}>
                <span class="multiselect-option-text">${label}</span>
            `;

            option.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleIndexSelection(indexData.id);
            });

            indexList.appendChild(option);
        });

        groupWrapper.appendChild(indexList);
        optionsContainer.appendChild(groupWrapper);
    });
}

// Toggle index selection
async function toggleIndexSelection(indexId) {
    if (rawDataState.selectedIndexes.has(indexId)) {
        rawDataState.selectedIndexes.delete(indexId);
    } else {
        rawDataState.selectedIndexes.add(indexId);
    }
    renderIndexesOptions();
    renderIndexesTags();
    buildRawDataTableHeaders();
    renderRawDataTable();
    // Update year range for selected indexes
    await loadRawDataYearRange();
    await updateRawDataYearSlider();
}

// Render indexes tags
function renderIndexesTags() {
    const tagsContainer = document.getElementById('indexesTags');
    if (!tagsContainer) return;

    tagsContainer.innerHTML = '';

    if (rawDataState.selectedIndexes.size === 0) {
        return;
    }

    // If all indexes are selected, show "All" tag
    if (rawDataState.selectedIndexes.size === indexColumns.length) {
        const allTag = document.createElement('div');
        allTag.className = 'multiselect-tag';
        allTag.innerHTML = `<span class="multiselect-tag-text">${t('raw-data-all-indexes')}</span>`;
        tagsContainer.appendChild(allTag);
        return;
    }

    const selectedArray = Array.from(rawDataState.selectedIndexes);

    // Create tag element for measurement
    const createTagEl = (indexId) => {
        const index = state.indexes.find(i => i.id === indexId);
        const label = getIndexLabel(index) || indexId;
        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `<span class="multiselect-tag-text">${label}</span><button type="button" class="multiselect-tag-remove">&times;</button>`;
        return tag;
    };

    const createMoreTagEl = (count) => {
        const tag = document.createElement('div');
        tag.className = 'multiselect-tag multiselect-tag--more';
        tag.innerHTML = `<span class="multiselect-tag-text">+${count}</span>`;
        return tag;
    };

    // Calculate how many tags fit
    const fittingCount = calculateFittingTags(tagsContainer, selectedArray, createTagEl, createMoreTagEl);
    const displayedIndexes = selectedArray.slice(0, fittingCount);

    displayedIndexes.forEach(indexId => {
        const index = state.indexes.find(i => i.id === indexId);
        const label = getIndexLabel(index) || indexId;

        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `
            <span class="multiselect-tag-text">${label}</span>
            <button type="button" class="multiselect-tag-remove" data-value="${indexId}">&times;</button>
        `;

        tag.querySelector('.multiselect-tag-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            rawDataState.selectedIndexes.delete(indexId);
            renderIndexesOptions();
            renderIndexesTags();
            buildRawDataTableHeaders();
            renderRawDataTable();
        });

        tagsContainer.appendChild(tag);
    });

    // Show count if more tags exist
    if (selectedArray.length > fittingCount) {
        const moreTag = document.createElement('div');
        moreTag.className = 'multiselect-tag multiselect-tag--more';
        moreTag.innerHTML = `<span class="multiselect-tag-text">+${selectedArray.length - fittingCount}</span>`;
        tagsContainer.appendChild(moreTag);
    }
}

// Render continent options
function renderContinentOptions() {
    const optionsContainer = document.getElementById('continentOptions');
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';

    rawDataState.allContinents.forEach(continent => {
        const isSelected = rawDataState.selectedContinents.has(continent);

        const option = document.createElement('div');
        option.className = `multiselect-option ${isSelected ? 'selected' : ''}`;
        option.dataset.value = continent;
        option.innerHTML = `
            <input type="checkbox" class="multiselect-checkbox" ${isSelected ? 'checked' : ''}>
            <span class="multiselect-option-text">${continent}</span>
        `;

        option.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleContinentSelection(continent);
        });

        optionsContainer.appendChild(option);
    });
}

// Get countries grouped by continent
function getCountriesByContinent() {
    const continents = [];
    const continentMap = new Map();

    rawDataState.allCountries.forEach(country => {
        const continent = country.continent || 'Other';
        if (!continentMap.has(continent)) {
            continentMap.set(continent, []);
            continents.push(continent);
        }
        continentMap.get(continent).push(country);
    });

    // Sort continents alphabetically
    continents.sort();

    return continents.map(cont => ({
        continent: cont,
        countries: continentMap.get(cont)
    }));
}

// Render country options grouped by continent in two-column layout
function renderCountryOptions() {
    const optionsContainer = document.getElementById('countryOptions');
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';

    // Get countries grouped by continent
    const groupedCountries = getCountriesByContinent();

    groupedCountries.forEach((group) => {
        const isCollapsed = rawDataState.collapsedCountryContinents.has(group.continent);
        const countryCodes = group.countries.map(c => c.code);
        const selectedCount = countryCodes.filter(code => rawDataState.selectedCountries.has(code)).length;

        // Create a wrapper for the entire continent group (header + countries)
        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'multiselect-continent-group';
        groupWrapper.dataset.continent = group.continent;

        // Determine button states
        const allSelected = selectedCount === group.countries.length;
        const noneSelected = selectedCount === 0;

        // Create continent header with collapse toggle, select/clear buttons
        const header = document.createElement('div');
        header.className = `multiselect-category-header multiselect-collapsible-header ${isCollapsed ? 'collapsed' : ''}`;
        header.innerHTML = `
            <button type="button" class="multiselect-collapse-btn" title="${isCollapsed ? 'Expand' : 'Collapse'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <span class="multiselect-category-title">${group.continent} <span class="multiselect-category-count">(${selectedCount}/${group.countries.length})</span></span>
            <div class="multiselect-category-actions">
                <button type="button" class="multiselect-category-btn multiselect-category-select ${allSelected ? 'inactive' : ''}" title="Select all ${group.continent}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
                </button>
                <button type="button" class="multiselect-category-btn multiselect-category-clear ${noneSelected ? 'inactive' : ''}" title="Clear all ${group.continent}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                </button>
            </div>
        `;

        // Collapse/expand toggle - clicking anywhere on header (except action buttons)
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            if (rawDataState.collapsedCountryContinents.has(group.continent)) {
                rawDataState.collapsedCountryContinents.delete(group.continent);
            } else {
                rawDataState.collapsedCountryContinents.add(group.continent);
            }
            renderCountryOptions();
        });

        // Select all for this continent
        const selectBtn = header.querySelector('.multiselect-category-select');
        selectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            countryCodes.forEach(code => rawDataState.selectedCountries.add(code));
            renderCountryOptions();
            renderCountryTags();
            applyRawDataFilters();
        });

        // Clear all for this continent
        const clearBtn = header.querySelector('.multiselect-category-clear');
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            countryCodes.forEach(code => rawDataState.selectedCountries.delete(code));
            renderCountryOptions();
            renderCountryTags();
            applyRawDataFilters();
        });

        groupWrapper.appendChild(header);

        // Create collapsible container for countries
        const countryList = document.createElement('div');
        countryList.className = `multiselect-collapsible-content ${isCollapsed ? 'collapsed' : ''}`;

        // Create options for each country in the continent
        group.countries.forEach(country => {
            const label = country.label;
            const isSelected = rawDataState.selectedCountries.has(country.code);

            const option = document.createElement('div');
            option.className = `multiselect-option ${isSelected ? 'selected' : ''}`;
            option.dataset.value = country.code;
            option.dataset.continent = group.continent;
            option.innerHTML = `
                <input type="checkbox" class="multiselect-checkbox" ${isSelected ? 'checked' : ''}>
                <span class="multiselect-option-text">${label}</span>
            `;

            option.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCountrySelection(country.code);
            });

            countryList.appendChild(option);
        });

        groupWrapper.appendChild(countryList);
        optionsContainer.appendChild(groupWrapper);
    });

    // Update dropdown sizing based on current content
    updateCountryDropdownWidth();
}

// Toggle continent selection
function toggleContinentSelection(continent) {
    if (rawDataState.selectedContinents.has(continent)) {
        rawDataState.selectedContinents.delete(continent);
    } else {
        rawDataState.selectedContinents.add(continent);
    }
    renderContinentOptions();
    renderContinentTags();
    applyRawDataFilters();
}

// Toggle country selection
function toggleCountrySelection(countryCode) {
    if (rawDataState.selectedCountries.has(countryCode)) {
        rawDataState.selectedCountries.delete(countryCode);
    } else {
        rawDataState.selectedCountries.add(countryCode);
    }
    renderCountryOptions();
    renderCountryTags();
    applyRawDataFilters();
}

// Calculate how many tags fit in the container (single row)
function calculateFittingTags(tagsContainer, items, createTagFn, createMoreTagFn) {
    // Get the tags container width directly
    const containerWidth = tagsContainer.clientWidth;

    // If container has no width yet, return a reasonable default
    if (containerWidth <= 0) {
        return Math.min(3, items.length);
    }

    const tagGap = 6; // 0.375rem gap

    // Create temporary container for measurement (single row, no wrap)
    const tempContainer = document.createElement('div');
    tempContainer.style.cssText = 'position: absolute; visibility: hidden; display: flex; flex-wrap: nowrap; gap: 6px; white-space: nowrap;';
    document.body.appendChild(tempContainer);

    let fittingCount = 0;
    let totalWidth = 0;

    // First, measure the "+n" tag to know how much space to reserve
    const moreTagSample = createMoreTagFn(99); // Use 99 for max width estimation
    tempContainer.appendChild(moreTagSample);
    const moreTagWidth = moreTagSample.getBoundingClientRect().width;
    moreTagSample.remove();

    for (let i = 0; i < items.length; i++) {
        const tag = createTagFn(items[i]);
        tempContainer.appendChild(tag);

        const tagWidth = tag.getBoundingClientRect().width;
        const gapWidth = fittingCount > 0 ? tagGap : 0;
        const widthWithThisTag = totalWidth + tagWidth + gapWidth;

        // Check if this is the last item
        const isLastItem = i === items.length - 1;

        // If it's not the last item, we need to reserve space for "+n" tag
        const spaceForMore = isLastItem ? 0 : moreTagWidth + tagGap;
        const requiredWidth = widthWithThisTag + spaceForMore;

        if (requiredWidth > containerWidth) {
            // This tag doesn't fit
            tag.remove();
            // If no tags fit at all, force at least one (it will be truncated visually)
            if (fittingCount === 0) {
                fittingCount = 1;
            }
            break;
        }

        totalWidth = widthWithThisTag;
        fittingCount++;
    }

    document.body.removeChild(tempContainer);
    return fittingCount;
}

// Render continent tags
function renderContinentTags() {
    const tagsContainer = document.getElementById('continentTags');
    if (!tagsContainer) return;

    tagsContainer.innerHTML = '';

    if (rawDataState.selectedContinents.size === 0) {
        return;
    }

    // If all continents are selected, show "All" tag
    if (rawDataState.selectedContinents.size === rawDataState.allContinents.length) {
        const allTag = document.createElement('div');
        allTag.className = 'multiselect-tag';
        allTag.innerHTML = `<span class="multiselect-tag-text">${t('raw-data-all-continents')}</span>`;
        tagsContainer.appendChild(allTag);
        return;
    }

    const selectedArray = Array.from(rawDataState.selectedContinents);

    // Create tag element for measurement
    const createTagEl = (continent) => {
        const localizedName = continent;
        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `<span class="multiselect-tag-text">${localizedName}</span><button type="button" class="multiselect-tag-remove">&times;</button>`;
        return tag;
    };

    const createMoreTagEl = (count) => {
        const tag = document.createElement('div');
        tag.className = 'multiselect-tag multiselect-tag--more';
        tag.innerHTML = `<span class="multiselect-tag-text">+${count}</span>`;
        return tag;
    };

    // Calculate how many tags fit
    const fittingCount = calculateFittingTags(tagsContainer, selectedArray, createTagEl, createMoreTagEl);
    const displayedContinents = selectedArray.slice(0, fittingCount);

    displayedContinents.forEach(continent => {
        const localizedName = continent;

        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `
            <span class="multiselect-tag-text">${localizedName}</span>
            <button type="button" class="multiselect-tag-remove" data-value="${continent}">&times;</button>
        `;

        tag.querySelector('.multiselect-tag-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            rawDataState.selectedContinents.delete(continent);
            renderContinentOptions();
            renderContinentTags();
            applyRawDataFilters();
        });

        tagsContainer.appendChild(tag);
    });

    // Show count if more tags exist
    if (selectedArray.length > fittingCount) {
        const moreTag = document.createElement('div');
        moreTag.className = 'multiselect-tag multiselect-tag--more';
        moreTag.innerHTML = `<span class="multiselect-tag-text">+${selectedArray.length - fittingCount}</span>`;
        tagsContainer.appendChild(moreTag);
    }
}

// Render country tags
function renderCountryTags() {
    const tagsContainer = document.getElementById('countryTags');
    if (!tagsContainer) return;

    tagsContainer.innerHTML = '';

    if (rawDataState.selectedCountries.size === 0) {
        return;
    }

    // If all countries are selected, show "All" tag
    if (rawDataState.selectedCountries.size === rawDataState.allCountries.length) {
        const allTag = document.createElement('div');
        allTag.className = 'multiselect-tag';
        allTag.innerHTML = `<span class="multiselect-tag-text">${t('raw-data-all-countries')}</span>`;
        tagsContainer.appendChild(allTag);
        return;
    }

    const selectedArray = Array.from(rawDataState.selectedCountries);

    // Create tag element for measurement
    const createTagEl = (countryCode) => {
        const country = rawDataState.allCountries.find(c => c.code === countryCode);
        const name = country ? country.label : countryCode;
        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `<span class="multiselect-tag-text">${name}</span><button type="button" class="multiselect-tag-remove">&times;</button>`;
        return tag;
    };

    const createMoreTagEl = (count) => {
        const tag = document.createElement('div');
        tag.className = 'multiselect-tag multiselect-tag--more';
        tag.innerHTML = `<span class="multiselect-tag-text">+${count}</span>`;
        return tag;
    };

    // Calculate how many tags fit
    const fittingCount = calculateFittingTags(tagsContainer, selectedArray, createTagEl, createMoreTagEl);
    const displayedCountries = selectedArray.slice(0, fittingCount);

    displayedCountries.forEach(countryCode => {
        const country = rawDataState.allCountries.find(c => c.code === countryCode);
        if (!country) return;

        const name = country.label;

        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `
            <span class="multiselect-tag-text">${name}</span>
            <button type="button" class="multiselect-tag-remove" data-value="${countryCode}">&times;</button>
        `;

        tag.querySelector('.multiselect-tag-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            rawDataState.selectedCountries.delete(countryCode);
            renderCountryOptions();
            renderCountryTags();
            applyRawDataFilters();
        });

        tagsContainer.appendChild(tag);
    });

    // Show count if more tags exist
    if (selectedArray.length > fittingCount) {
        const moreTag = document.createElement('div');
        moreTag.className = 'multiselect-tag multiselect-tag--more';
        moreTag.innerHTML = `<span class="multiselect-tag-text">+${selectedArray.length - fittingCount}</span>`;
        tagsContainer.appendChild(moreTag);
    }
}

// Filter multiselect options
function filterMultiselectOptions(type, searchTerm) {
    const optionsContainer = document.getElementById(`${type}Options`);
    if (!optionsContainer) return;

    const options = optionsContainer.querySelectorAll('.multiselect-option');
    let visibleCount = 0;

    options.forEach(option => {
        const text = option.querySelector('.multiselect-option-text').textContent.toLowerCase();
        const code = (option.dataset.value || '').toLowerCase();
        const matches = text.includes(searchTerm) || (type === 'country' && code.includes(searchTerm));
        option.classList.toggle('hidden', !matches);
        if (matches) visibleCount++;
    });

    // For indexes, handle category group wrappers visibility
    if (type === 'indexes') {
        const groupWrappers = optionsContainer.querySelectorAll('.multiselect-index-group');
        groupWrappers.forEach(wrapper => {
            const indexList = wrapper.querySelector('.multiselect-index-list');
            if (indexList) {
                const visibleOptions = indexList.querySelectorAll('.multiselect-option:not(.hidden)');
                const hasVisibleOptions = visibleOptions.length > 0;
                wrapper.classList.toggle('hidden', !hasVisibleOptions);
            }
        });
    }

    // For country, handle continent group wrappers visibility
    if (type === 'country') {
        const groupWrappers = optionsContainer.querySelectorAll('.multiselect-continent-group');
        groupWrappers.forEach(wrapper => {
            const header = wrapper.querySelector('.multiselect-category-header');
            const contentContainer = wrapper.querySelector('.multiselect-collapsible-content');
            if (header && contentContainer) {
                const visibleOptions = contentContainer.querySelectorAll('.multiselect-option:not(.hidden)');
                const hasVisibleOptions = visibleOptions.length > 0;
                wrapper.classList.toggle('hidden', !hasVisibleOptions);

                // When searching, expand collapsed groups that have matches
                if (searchTerm && hasVisibleOptions) {
                    header.classList.remove('collapsed');
                    contentContainer.classList.remove('collapsed');
                }
            }
        });
    }

    // Show/hide no results message
    let noResults = optionsContainer.querySelector('.multiselect-no-results');
    if (visibleCount === 0) {
        if (!noResults) {
            noResults = document.createElement('div');
            noResults.className = 'multiselect-no-results';
            noResults.textContent = t('raw-data-no-data');
            optionsContainer.appendChild(noResults);
        }
    } else if (noResults) {
        noResults.remove();
    }
}

// Set up event listeners for raw data controls
function setupRawDataEventListeners() {
    // Year slider and input
    const yearSlider = document.getElementById('rawDataYearSlider');
    const yearInput = document.getElementById('rawDataYearInput');

    if (yearSlider) {
        // Sync slider to input and update position
        yearSlider.addEventListener('input', (e) => {
            rawDataState.currentYear = parseInt(e.target.value);
            if (yearInput) {
                yearInput.value = rawDataState.currentYear;
                updateYearInputPosition(yearSlider, yearInput);
            }
            loadRawData();
        });
    }

    if (yearInput) {
        // Sync input to slider with validation
        yearInput.addEventListener('input', (e) => {
            let value = parseInt(e.target.value);
            const min = parseInt(yearSlider.min);
            const max = parseInt(yearSlider.max);

            if (!isNaN(value)) {
                value = Math.max(min, Math.min(max, value));
                rawDataState.currentYear = value;
                yearSlider.value = value;
                updateYearInputPosition(yearSlider, yearInput);
                loadRawData();
            }
        });

        // Validate and correct on blur
        yearInput.addEventListener('blur', (e) => {
            let value = parseInt(e.target.value);
            const min = parseInt(yearSlider.min);
            const max = parseInt(yearSlider.max);

            if (isNaN(value) || value < min) {
                value = min;
            } else if (value > max) {
                value = max;
            }
            yearInput.value = value;
            yearSlider.value = value;
            rawDataState.currentYear = value;
            updateYearInputPosition(yearSlider, yearInput);
        });
    }
}

// Build table headers
function buildRawDataTableHeaders() {
    const headerRow = document.getElementById('rawDataTableHeader');
    if (!headerRow) return;

    headerRow.innerHTML = '';

    // Column configuration for rendering
    const columnConfig = {
        'rank': {
            className: 'rank-col',
            text: '#',
            sortable: false,
            draggable: false
        },
        'country_name': {
            className: 'name-col sortable',
            text: t('raw-data-country-name'),
            sortable: true,
            draggable: false
        },
        'continent': {
            className: 'continent-col sortable',
            text: t('raw-data-continent-col'),
            sortable: true,
            draggable: false
        }
    };

    // Add index columns to config
    indexColumns.forEach(col => {
        const index = state.indexes.find(i => i.id === col.id);
        columnConfig[col.id] = {
            className: 'index-col sortable draggable',
            text: getIndexLabel(index) || col.id,
            sortable: true,
            draggable: true,
            isIndex: true
        };
    });

    // Render columns in order
    rawDataState.columnOrder.forEach(colId => {
        const config = columnConfig[colId];
        if (!config) return;

        // Skip unselected index columns
        if (config.isIndex && !rawDataState.selectedIndexes.has(colId)) return;

        const th = document.createElement('th');
        th.className = config.className;
        th.dataset.column = colId;
        th.textContent = config.text;

        if (config.sortable) {
            th.addEventListener('click', (e) => {
                // Don't sort if we just finished dragging
                if (th.dataset.justDragged) {
                    delete th.dataset.justDragged;
                    return;
                }
                handleRawDataSort(colId);
            });
        }

        if (config.draggable) {
            th.draggable = true;
            th.addEventListener('dragstart', handleColumnDragStart);
            th.addEventListener('dragend', handleColumnDragEnd);
            th.addEventListener('dragover', handleColumnDragOver);
            th.addEventListener('dragleave', handleColumnDragLeave);
            th.addEventListener('drop', handleColumnDrop);
            th.addEventListener('mousemove', handleColumnMouseMove);
            th.addEventListener('mouseleave', handleColumnMouseLeave);
        }

        headerRow.appendChild(th);
    });

    // Set initial sort indicator
    updateSortIndicators();
    updateRawDataStickyDivider();
}

// Ensure the raw data divider element exists
function ensureRawDataDivider() {
    const wrapper = document.querySelector('.raw-data-table-wrapper');
    if (!wrapper) return null;

    let divider = wrapper.querySelector('.raw-data-divider');
    if (!divider) {
        divider = document.createElement('div');
        divider.className = 'raw-data-divider';
        wrapper.appendChild(divider);
    }
    return divider;
}

// Update the divider that separates sticky and scrollable columns
function updateRawDataStickyDivider() {
    const wrapper = document.querySelector('.raw-data-table-wrapper');
    const headerRow = document.getElementById('rawDataTableHeader');
    const divider = ensureRawDataDivider();

    if (!wrapper || !headerRow || !divider || headerRow.children.length === 0) {
        if (divider) {
            divider.style.display = 'none';
        }
        return;
    }

    const stickyCells = headerRow.querySelectorAll('.rank-col, .name-col, .continent-col');
    const wrapperRect = wrapper.getBoundingClientRect();
    let boundary = 0;

    stickyCells.forEach(cell => {
        const rect = cell.getBoundingClientRect();
        const rightEdge = rect.right - wrapperRect.left;
        boundary = Math.max(boundary, rightEdge);
    });

    if (boundary > 0) {
        const boundaryPx = `${boundary}px`;
        divider.style.left = boundaryPx;
        divider.style.setProperty('--raw-divider-left', boundaryPx);
        divider.style.display = 'block';
    } else {
        divider.style.display = 'none';
    }
}

// Expand country column to fit longest name (desktop only)
function updateRawDataNameColumnWidth() {
    const table = document.getElementById('rawDataTable');
    if (!table) return;

    const isDesktop = window.matchMedia('(min-width: 901px)').matches;
    if (!isDesktop) {
        table.style.removeProperty('--raw-name-col-width');
        return;
    }

    if (!state.countries || state.countries.length === 0) return;

    const measurer = document.createElement('span');
    measurer.style.cssText = [
        'position:absolute',
        'visibility:hidden',
        'pointer-events:none',
        'white-space:nowrap',
        'font-size:0.8125rem',
        'font-weight:600',
        'font-family:inherit'
    ].join(';');
    document.body.appendChild(measurer);

    let maxWidth = 0;
    state.countries.forEach(c => {
        const label = buildCountryLabel(c.country_name, c.flag) || c.country_code;
        measurer.textContent = label;
        const width = measurer.getBoundingClientRect().width;
        if (width > maxWidth) maxWidth = width;
    });

    document.body.removeChild(measurer);

    // Add horizontal padding from table cells (~0.75rem each side) and a small buffer
    const paddedWidth = Math.min(Math.max(maxWidth + 24, 150), 400);
    table.style.setProperty('--raw-name-col-width', `${paddedWidth}px`);
}

// Column drag and drop handlers
const EDGE_THRESHOLD = 20; // Pixels from edge for sort cursor zone

function handleColumnMouseMove(e) {
    const th = e.target.closest('th');
    if (!th || !th.classList.contains('draggable')) return;
    if (rawDataState.draggedColumn) return; // Don't change cursor while dragging

    const rect = th.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isNearEdge = x < EDGE_THRESHOLD || x > rect.width - EDGE_THRESHOLD;

    // Grab cursor in center (for reordering), pointer at edges (for sorting)
    if (isNearEdge) {
        th.classList.remove('drag-ready');
    } else {
        th.classList.add('drag-ready');
    }
}

function handleColumnMouseLeave(e) {
    const th = e.target.closest('th');
    if (!th) return;
    th.classList.remove('drag-ready');
}

function handleColumnDragStart(e) {
    const th = e.target.closest('th');
    if (!th) return;

    rawDataState.draggedColumn = th.dataset.column;
    th.classList.add('dragging');
    th.classList.remove('drag-ready');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', th.dataset.column);
}

function handleColumnDragEnd(e) {
    const th = e.target.closest('th');
    if (th) {
        th.classList.remove('dragging');
    }
    rawDataState.draggedColumn = null;

    // Remove all drag-over classes
    document.querySelectorAll('#rawDataTableHeader th').forEach(header => {
        header.classList.remove('drag-over-left', 'drag-over-right');
    });
}

function handleColumnDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const th = e.target.closest('th');
    if (!th || th.dataset.column === rawDataState.draggedColumn) return;
    if (th.dataset.column === 'rank') return;

    // Determine which side of the column we're on
    const rect = th.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isLeftHalf = x < rect.width / 2;

    // Clear previous indicators from all headers
    document.querySelectorAll('#rawDataTableHeader th').forEach(header => {
        if (header !== th) {
            header.classList.remove('drag-over-left', 'drag-over-right');
        }
    });

    // Set appropriate indicator
    if (isLeftHalf) {
        th.classList.add('drag-over-left');
        th.classList.remove('drag-over-right');
    } else {
        th.classList.add('drag-over-right');
        th.classList.remove('drag-over-left');
    }
}

function handleColumnDragLeave(e) {
    const th = e.target.closest('th');
    if (!th) return;

    // Only remove if we're actually leaving the element
    const rect = th.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom) {
        th.classList.remove('drag-over-left', 'drag-over-right');
    }
}

function handleColumnDrop(e) {
    e.preventDefault();
    const targetTh = e.target.closest('th');
    if (!targetTh) return;

    const draggedColumn = rawDataState.draggedColumn;
    const targetColumn = targetTh.dataset.column;

    if (!draggedColumn || draggedColumn === targetColumn) return;
    if (targetColumn === 'rank') return;

    // Determine which side we're dropping on
    const rect = targetTh.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isLeftHalf = x < rect.width / 2;

    // Mark that we just dragged (to prevent sort on click)
    targetTh.dataset.justDragged = 'true';

    // Reorder columns
    const order = [...rawDataState.columnOrder];
    const draggedIndex = order.indexOf(draggedColumn);
    const targetIndex = order.indexOf(targetColumn);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Remove dragged column first
    order.splice(draggedIndex, 1);

    // Calculate new target index (may have shifted after removal)
    let newTargetIndex = order.indexOf(targetColumn);

    // Insert at the appropriate side
    if (isLeftHalf) {
        // Insert before target
        order.splice(newTargetIndex, 0, draggedColumn);
    } else {
        // Insert after target
        order.splice(newTargetIndex + 1, 0, draggedColumn);
    }

    rawDataState.columnOrder = order;

    // Re-render table
    buildRawDataTableHeaders();
    renderRawDataTable();
}

// Handle sort column click
function handleRawDataSort(column) {
    if (rawDataState.sortColumn === column) {
        // Toggle direction
        rawDataState.sortDirection = rawDataState.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        // New column, default to ascending for text, descending for numbers
        rawDataState.sortColumn = column;
        const isNumeric = indexColumns.some(c => c.id === column);
        rawDataState.sortDirection = isNumeric ? 'desc' : 'asc';
    }

    updateSortIndicators();
    sortRawData();
    renderRawDataTable();
}

// Update sort indicators in table headers
function updateSortIndicators() {
    const headers = document.querySelectorAll('#rawDataTableHeader th.sortable');
    headers.forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.column === rawDataState.sortColumn) {
            th.classList.add(rawDataState.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
}

// Load raw data from API
async function loadRawData() {
    // Don't show loading state - keep old data visible
    rawDataState.isLoading = true;

    try {
        const response = await fetch(`/api/raw-data?year=${rawDataState.currentYear}`);
        const rawRows = await response.json();
        rawDataState.data = rawRows.map(row => ({
            ...row,
            country_display_name: row.country_display_name || buildCountryLabel(row.country_name, row.flag)
        }));
        console.log(`Raw data loaded for year ${rawDataState.currentYear}: ${rawDataState.data.length} rows`);

        applyRawDataFilters();
    } catch (error) {
        console.error('Error loading raw data:', error);
        // Only clear data if we have no existing data
        if (rawDataState.data.length === 0) {
            rawDataState.filteredData = [];
            renderRawDataTable();
        }
    } finally {
        rawDataState.isLoading = false;
    }
}

// Apply filters to raw data
function applyRawDataFilters() {
    let filtered = [...rawDataState.data];

    // Filter by selected countries only
    if (rawDataState.selectedCountries.size === 0) {
        // Nothing selected = show nothing
        rawDataState.filteredData = [];
    } else {
        // Show only countries that are selected
        filtered = filtered.filter(row => rawDataState.selectedCountries.has(row.country_code));
        rawDataState.filteredData = filtered;
    }

    sortRawData();
    renderRawDataTable();
}

// Sort raw data
function sortRawData() {
    const column = rawDataState.sortColumn;
    const direction = rawDataState.sortDirection;

    rawDataState.filteredData.sort((a, b) => {
        let valA, valB;

        // Get values based on column
        if (column === 'country_name') {
            valA = (a.country_name || '').toLowerCase();
            valB = (b.country_name || '').toLowerCase();
        } else if (column === 'continent') {
            valA = (a.continent || '').toLowerCase();
            valB = (b.continent || '').toLowerCase();
        } else if (column === 'country_code') {
            valA = a.country_code;
            valB = b.country_code;
        } else {
            // Numeric column
            valA = a[column];
            valB = b[column];
        }

        // Handle null values - put them at the end
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;

        // Compare
        let comparison;
        if (typeof valA === 'string') {
            comparison = valA.localeCompare(valB);
        } else {
            comparison = valA - valB;
        }

        return direction === 'asc' ? comparison : -comparison;
    });
}

// Render raw data table
function renderRawDataTable() {
    const tbody = document.getElementById('rawDataTableBody');
    const loadingEl = document.getElementById('rawDataLoading');
    const noDataEl = document.getElementById('rawDataNoData');
    const table = document.getElementById('rawDataTable');

    if (!tbody) return;

    // Always hide loading element (we keep old data visible during load)
    if (loadingEl) loadingEl.style.display = 'none';

    // Check for empty data
    if (rawDataState.filteredData.length === 0) {
        if (noDataEl) noDataEl.style.display = 'flex';
        if (table) table.style.display = 'none';
        return;
    }

    // Show table
    if (noDataEl) noDataEl.style.display = 'none';
    if (table) table.style.display = 'table';

    // Clear existing rows
    tbody.innerHTML = '';

    // Helper function to create a cell for a column
    const createCell = (colId, row, rowIndex) => {
        const td = document.createElement('td');

        switch (colId) {
            case 'rank':
                td.className = 'rank-col';
                td.textContent = rowIndex + 1;
                break;
            case 'country_name':
                td.className = 'name-col';
                td.textContent = row.country_display_name || row.country_name;
                break;
            case 'continent':
                td.className = 'continent-col';
                td.textContent = row.continent;
                break;
            default:
                // Index column
                const col = indexColumns.find(c => c.id === colId);
                if (!col) return null;
                if (!rawDataState.selectedIndexes.has(colId)) return null;

                td.className = 'index-col';
                const value = row[colId];
                if (value === null || value === undefined) {
                    td.textContent = '—';
                    td.classList.add('null-value');
                } else {
                    td.textContent = formatNumber(value, col.decimals);
                }
                break;
        }

        return td;
    };

    // Render rows
    rawDataState.filteredData.forEach((row, index) => {
        const tr = document.createElement('tr');

        // Render cells in column order
        rawDataState.columnOrder.forEach(colId => {
            const td = createCell(colId, row, index);
            if (td) {
                tr.appendChild(td);
            }
        });

        tbody.appendChild(tr);
    });
}

// Format number with appropriate decimal places and thousands separator
function formatNumber(value, decimals) {
    if (value === null || value === undefined) return '—';

    const num = Number(value);
    if (isNaN(num)) return value;

    // Format with locale-aware thousands separator
    return num.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

// ============================================
// MAP TAB FUNCTIONALITY
// ============================================

// Map state
const mapState = {
    initialized: false,
    geoData: null,
    data: {},
    currentYear: null,
    currentIndex: null,
    currentContinent: 'all',
    availableYears: [],
    yearRange: null, // Year range for current index (trimmed based on data availability)
    projection: null,
    path: null,
    svg: null,
    colorScale: null,
    globalMinValue: null, // Global min value across all years for consistent color scale
    globalMaxValue: null  // Global max value across all years for consistent color scale
};

// Country code mapping for different naming conventions
const countryCodeMapping = {
    // ISO 3166-1 alpha-3 to Natural Earth / World Bank codes
    'USA': 'USA',
    'GBR': 'GBR',
    'FRA': 'FRA',
    'DEU': 'DEU',
    'CHN': 'CHN',
    'RUS': 'RUS',
    'BRA': 'BRA',
    'IND': 'IND',
    'CAN': 'CAN',
    'AUS': 'AUS'
    // Add more mappings if needed
};

// Initialize Map tab
async function initializeMapTab() {
    if (mapState.initialized) return;

    console.log('Initializing Map tab...');

    // Show loading state
    const mapContainer = document.getElementById('worldMap');
    if (mapContainer) {
        mapContainer.innerHTML = '<div class="map-loading">Loading map...</div>';
    }

    // Load GeoJSON data
    await loadGeoData();

    // Load available years
    await loadMapYears();

    // Setup year slider
    setupMapYearSlider();

    // Setup index selector (loads year range for default index)
    await setupMapIndexSelector();

    // Setup continent selector
    setupMapContinentSelector();

    // Mark as initialized
    mapState.initialized = true;

    // Load initial data and render map
    await loadMapData();
    renderMap();

    console.log('Map tab initialized');
}

// Load world GeoJSON data
async function loadGeoData() {
    try {
        // Use local GeoJSON with internationally recognized borders
        const response = await fetch('/data/countries.geojson?v=3');
        const geoData = await response.json();

        mapState.geoData = geoData;

        console.log('GeoJSON loaded:', mapState.geoData.features.length, 'countries');
    } catch (error) {
        console.error('Error loading GeoJSON:', error);
    }
}


// Load available years for map
async function loadMapYears() {
    try {
        const response = await fetch('/api/raw-data/years');
        mapState.availableYears = await response.json();
        console.log('Map years loaded:', mapState.availableYears.length);
    } catch (error) {
        console.error('Error loading map years:', error);
        mapState.availableYears = [];
    }
}

// Load year range for a specific index (for Map tab)
async function loadMapYearRange(index) {
    try {
        const response = await fetch(`/api/years?index=${index}`);
        const yearRange = await response.json();
        console.log('Map year range loaded for index', index, ':', yearRange);
        return yearRange;
    } catch (error) {
        console.error('Error loading map year range:', error);
        return null;
    }
}

// Load global min/max values for an index across all years (for consistent color scale)
async function loadMapGlobalRange(index, continent = 'all') {
    try {
        const continentParam = continent !== 'all' ? `&continent=${continent}` : '';
        const response = await fetch(`/api/index-range?index=${index}${continentParam}`);
        const range = await response.json();
        console.log('Map global range loaded for index', index, 'continent', continent, ':', range);
        return range;
    } catch (error) {
        console.error('Error loading map global range:', error);
        return { min_value: null, max_value: null };
    }
}

// Update map year slider based on current index's data availability
async function updateMapYearSlider() {
    const slider = document.getElementById('mapYearSlider');
    const yearInput = document.getElementById('mapYearInput');
    const minEl = document.getElementById('mapYearMin');
    const maxEl = document.getElementById('mapYearMax');

    if (!slider || mapState.availableYears.length === 0) return;

    // Get base range from all available years
    const baseMinYear = Math.min(...mapState.availableYears);
    const baseMaxYear = Math.max(...mapState.availableYears);

    // Use index-specific range if available, otherwise use base range
    let minYear = baseMinYear;
    let maxYear = baseMaxYear;

    if (mapState.yearRange && mapState.yearRange.min_year && mapState.yearRange.max_year) {
        minYear = mapState.yearRange.min_year;
        maxYear = mapState.yearRange.max_year;
    }

    // Clamp current value to new range
    const currentValue = parseInt(slider.value || maxYear, 10);
    const newValue = isNaN(currentValue) ? maxYear : Math.min(Math.max(currentValue, minYear), maxYear);

    slider.min = minYear;
    slider.max = maxYear;
    slider.value = newValue;
    mapState.currentYear = newValue;

    if (minEl) minEl.textContent = minYear;
    if (maxEl) maxEl.textContent = maxYear;
    if (yearInput) {
        yearInput.value = newValue;
        yearInput.min = minYear;
        yearInput.max = maxYear;
    }

    console.log(`Map year slider range: ${minYear}-${maxYear}, value: ${newValue}`);
}

// Setup year slider for map
function setupMapYearSlider() {
    const slider = document.getElementById('mapYearSlider');
    const yearInput = document.getElementById('mapYearInput');
    const minEl = document.getElementById('mapYearMin');
    const maxEl = document.getElementById('mapYearMax');

    if (!slider || mapState.availableYears.length === 0) return;

    const minYear = Math.min(...mapState.availableYears);
    const maxYear = Math.max(...mapState.availableYears);

    slider.min = minYear;
    slider.max = maxYear;

    // Default to the newest available year
    const defaultYear = maxYear;
    slider.value = defaultYear;
    mapState.currentYear = defaultYear;

    if (minEl) minEl.textContent = minYear;
    if (maxEl) maxEl.textContent = maxYear;
    if (yearInput) {
        yearInput.value = defaultYear;
        yearInput.min = minYear;
        yearInput.max = maxYear;
    }

    // Event listeners
    slider.addEventListener('input', async (e) => {
        mapState.currentYear = parseInt(e.target.value);
        if (yearInput) yearInput.value = mapState.currentYear;
        await loadMapData();
        renderMap();
    });

    if (yearInput) {
        yearInput.addEventListener('input', async (e) => {
            let value = parseInt(e.target.value);
            const min = parseInt(slider.min);
            const max = parseInt(slider.max);

            if (!isNaN(value)) {
                value = Math.max(min, Math.min(max, value));
                slider.value = value;
                mapState.currentYear = value;
                await loadMapData();
                renderMap();
            }
        });

        yearInput.addEventListener('blur', (e) => {
            let value = parseInt(e.target.value);
            const min = parseInt(slider.min);
            const max = parseInt(slider.max);

            if (isNaN(value) || value < min) value = min;
            else if (value > max) value = max;

            yearInput.value = value;
            slider.value = value;
        });
    }
}

// Setup index selector for map with category grouping (searchable select)
async function setupMapIndexSelector() {
    const selectorId = 'mapIndex';
    const container = document.getElementById(`${selectorId}-container`);
    const hiddenInput = document.getElementById(selectorId);
    const valueDisplay = document.getElementById(`${selectorId}-value`);
    const optionsContainer = document.getElementById(`${selectorId}-options`);

    if (!container || !hiddenInput || !optionsContainer) {
        console.error('Map index searchable select not found');
        return;
    }

    // Clear existing options
    optionsContainer.innerHTML = '';

    // Get indexes grouped by category
    const groupedIndexes = getIndexesByCategory();

    // Create groups for each category
    groupedIndexes.forEach(group => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'searchable-select-group';
        groupDiv.dataset.category = group.category;

        const header = document.createElement('div');
        header.className = 'searchable-select-group-header';
        header.textContent = group.category;
        groupDiv.appendChild(header);

        group.indexes.forEach(indexData => {
            const option = document.createElement('div');
            option.className = 'searchable-select-option';
            option.dataset.value = indexData.id;
            option.dataset.label = getIndexLabel(indexData);
            option.textContent = getIndexLabel(indexData);

            option.addEventListener('click', (e) => {
                e.stopPropagation();
                selectMapIndexOption(indexData.id, getIndexLabel(indexData));
            });

            groupDiv.appendChild(option);
        });

        optionsContainer.appendChild(groupDiv);
    });

    // Default to Median Age if available, otherwise first index
    if (state.indexes.length > 0) {
        const preferredIndex = state.indexes.find(idx => idx.id === 'median_age') || state.indexes[0];
        await selectMapIndexOption(preferredIndex.id, getIndexLabel(preferredIndex), false);
    }

    // Setup event handlers
    setupMapIndexSearchableSelectEvents();
}

// Select an option in map index searchable dropdown
async function selectMapIndexOption(value, label, triggerChange = true) {
    const selectorId = 'mapIndex';
    const container = document.getElementById(`${selectorId}-container`);
    const hiddenInput = document.getElementById(selectorId);
    const valueDisplay = document.getElementById(`${selectorId}-value`);
    const optionsContainer = document.getElementById(`${selectorId}-options`);

    if (!container || !hiddenInput || !valueDisplay) return;

    // Update hidden input
    const oldValue = hiddenInput.value;
    hiddenInput.value = value;

    // Update display
    valueDisplay.textContent = label;
    valueDisplay.classList.remove('placeholder');
    valueDisplay.classList.toggle('muted', value === '' && label === 'Disable size modality');

    // Update selected state in options
    optionsContainer.querySelectorAll('.searchable-select-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });

    // Close dropdown
    container.classList.remove('open');

    // Clear search
    const searchInput = container.querySelector('.searchable-select-search');
    if (searchInput) {
        searchInput.value = '';
        filterMapIndexOptions('');
    }

    // Update map if value changed
    if (triggerChange && oldValue !== value) {
        mapState.currentIndex = value;
        // Update year range for the new index (trim unavailable years)
        mapState.yearRange = await loadMapYearRange(value);
        // Load global min/max for consistent color scale across all years
        const globalRange = await loadMapGlobalRange(value, mapState.currentContinent);
        mapState.globalMinValue = globalRange.min_value;
        mapState.globalMaxValue = globalRange.max_value;
        await updateMapYearSlider();
        await loadMapData();
        renderMap();
    } else if (!triggerChange) {
        mapState.currentIndex = value;
        // Also update year range on initial selection
        mapState.yearRange = await loadMapYearRange(value);
        // Load global min/max for consistent color scale across all years
        const globalRange = await loadMapGlobalRange(value, mapState.currentContinent);
        mapState.globalMinValue = globalRange.min_value;
        mapState.globalMaxValue = globalRange.max_value;
        await updateMapYearSlider();
    }
}

// Filter map index options based on search query
function filterMapIndexOptions(query) {
    const optionsContainer = document.getElementById('mapIndex-options');
    if (!optionsContainer) return;

    const normalizedQuery = query.toLowerCase().trim();
    let hasVisibleOptions = false;

    optionsContainer.querySelectorAll('.searchable-select-group').forEach(group => {
        let groupHasVisible = false;

        group.querySelectorAll('.searchable-select-option').forEach(option => {
            const label = option.dataset.label.toLowerCase();
            const isVisible = !normalizedQuery || label.includes(normalizedQuery);
            option.classList.toggle('hidden', !isVisible);
            if (isVisible) groupHasVisible = true;
        });

        group.classList.toggle('hidden', !groupHasVisible);
        if (groupHasVisible) hasVisibleOptions = true;
    });

    // Show/hide no results message
    let noResultsEl = optionsContainer.querySelector('.searchable-select-no-results');
    if (!hasVisibleOptions) {
        if (!noResultsEl) {
            noResultsEl = document.createElement('div');
            noResultsEl.className = 'searchable-select-no-results';
            noResultsEl.textContent = 'No indexes found';
            optionsContainer.appendChild(noResultsEl);
        }
        noResultsEl.style.display = 'block';
    } else if (noResultsEl) {
        noResultsEl.style.display = 'none';
    }
}

// Setup event handlers for map index searchable select
function setupMapIndexSearchableSelectEvents() {
    const selectorId = 'mapIndex';
    const container = document.getElementById(`${selectorId}-container`);
    const trigger = container?.querySelector('.searchable-select-trigger');
    const searchInput = container?.querySelector('.searchable-select-search');
    const dropdown = container?.querySelector('.searchable-select-dropdown');

    if (!container || !trigger) return;

    // Toggle dropdown on trigger click
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = container.classList.contains('open');

        // Close all other searchable selects
        document.querySelectorAll('.searchable-select.open').forEach(el => {
            if (el !== container) el.classList.remove('open');
        });

        container.classList.toggle('open', !wasOpen);

        if (!wasOpen && searchInput) {
            setTimeout(() => searchInput.focus(), 10);
        }
    });

    // Search input handler
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterMapIndexOptions(e.target.value);
        });

        searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Keyboard navigation
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                container.classList.remove('open');
            } else if (e.key === 'Enter') {
                const visibleOption = container.querySelector('.searchable-select-option:not(.hidden)');
                if (visibleOption) {
                    visibleOption.click();
                }
            }
        });
    }

    // Prevent dropdown clicks from closing
    if (dropdown) {
        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
}

// Setup continent selector for map
function setupMapContinentSelector() {
    const selectorId = 'mapContinent';
    const container = document.getElementById(`${selectorId}-container`);
    const hiddenInput = document.getElementById(selectorId);
    const valueDisplay = document.getElementById(`${selectorId}-value`);
    const optionsContainer = document.getElementById(`${selectorId}-options`);

    if (!container || !hiddenInput || !optionsContainer) {
        console.error('Map continent searchable select not found');
        return;
    }

    // Clear existing options
    optionsContainer.innerHTML = '';

    // Add "All continents" option first
    const allOption = document.createElement('div');
    allOption.className = 'searchable-select-option selected';
    allOption.dataset.value = 'all';
    allOption.dataset.label = 'All continents';
    allOption.textContent = 'All continents';
    allOption.addEventListener('click', (e) => {
        e.stopPropagation();
        selectMapContinentOption('all', 'All continents');
    });
    optionsContainer.appendChild(allOption);

    // Get unique continents
    const continents = [...new Set(state.countries.map(c => c.continent))].filter(c => c).sort();

    continents.forEach(continent => {
        const option = document.createElement('div');
        option.className = 'searchable-select-option';
        option.dataset.value = continent;
        option.dataset.label = continent;
        option.textContent = continent;

        option.addEventListener('click', (e) => {
            e.stopPropagation();
            selectMapContinentOption(continent, continent);
        });

        optionsContainer.appendChild(option);
    });

    // Default to "all"
    mapState.currentContinent = 'all';

    // Setup event handlers
    setupMapContinentSearchableSelectEvents();
}

// Select an option in map continent searchable dropdown
async function selectMapContinentOption(value, label) {
    const selectorId = 'mapContinent';
    const container = document.getElementById(`${selectorId}-container`);
    const hiddenInput = document.getElementById(selectorId);
    const valueDisplay = document.getElementById(`${selectorId}-value`);
    const optionsContainer = document.getElementById(`${selectorId}-options`);

    if (!container || !hiddenInput || !valueDisplay) return;

    // Update hidden input
    const oldValue = hiddenInput.value;
    hiddenInput.value = value;

    // Update display
    valueDisplay.textContent = label;

    // Update selected state in options
    optionsContainer.querySelectorAll('.searchable-select-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });

    // Close dropdown
    container.classList.remove('open');

    // Clear search
    const searchInput = container.querySelector('.searchable-select-search');
    if (searchInput) {
        searchInput.value = '';
        filterMapContinentOptions('');
    }

    // Update map if value changed
    if (oldValue !== value) {
        mapState.currentContinent = value;
        // Reload global min/max for the new continent
        if (mapState.currentIndex) {
            const globalRange = await loadMapGlobalRange(mapState.currentIndex, value);
            mapState.globalMinValue = globalRange.min_value;
            mapState.globalMaxValue = globalRange.max_value;
        }
        renderMap();
    }
}

// Filter map continent options based on search query
function filterMapContinentOptions(query) {
    const optionsContainer = document.getElementById('mapContinent-options');
    if (!optionsContainer) return;

    const normalizedQuery = query.toLowerCase().trim();
    let hasVisibleOptions = false;

    optionsContainer.querySelectorAll('.searchable-select-option').forEach(option => {
        const label = option.dataset.label.toLowerCase();
        const isVisible = !normalizedQuery || label.includes(normalizedQuery);
        option.classList.toggle('hidden', !isVisible);
        if (isVisible) hasVisibleOptions = true;
    });

    // Show/hide no results message
    let noResultsEl = optionsContainer.querySelector('.searchable-select-no-results');
    if (!hasVisibleOptions) {
        if (!noResultsEl) {
            noResultsEl = document.createElement('div');
            noResultsEl.className = 'searchable-select-no-results';
            noResultsEl.textContent = 'No continents found';
            optionsContainer.appendChild(noResultsEl);
        }
        noResultsEl.style.display = 'block';
    } else if (noResultsEl) {
        noResultsEl.style.display = 'none';
    }
}

// Setup event handlers for map continent searchable select
function setupMapContinentSearchableSelectEvents() {
    const selectorId = 'mapContinent';
    const container = document.getElementById(`${selectorId}-container`);
    const trigger = container?.querySelector('.searchable-select-trigger');
    const searchInput = container?.querySelector('.searchable-select-search');
    const dropdown = container?.querySelector('.searchable-select-dropdown');

    if (!container || !trigger) return;

    // Toggle dropdown on trigger click
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = container.classList.contains('open');

        // Close all other searchable selects
        document.querySelectorAll('.searchable-select.open').forEach(el => {
            if (el !== container) el.classList.remove('open');
        });

        container.classList.toggle('open', !wasOpen);

        if (!wasOpen && searchInput) {
            setTimeout(() => searchInput.focus(), 10);
        }
    });

    // Search input handler
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterMapContinentOptions(e.target.value);
        });

        searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Keyboard navigation
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                container.classList.remove('open');
            } else if (e.key === 'Enter') {
                const visibleOption = container.querySelector('.searchable-select-option:not(.hidden)');
                if (visibleOption) {
                    visibleOption.click();
                }
            }
        });
    }

    // Prevent dropdown clicks from closing
    if (dropdown) {
        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
}

// Load map data for current year and index
async function loadMapData() {
    if (!mapState.currentYear || !mapState.currentIndex) return;

    try {
        const response = await fetch(`/api/raw-data?year=${mapState.currentYear}`);
        const rawData = await response.json();

        // Convert to map format with country code as key
        mapState.data = {};
        rawData.forEach(row => {
            if (row[mapState.currentIndex] !== null && row[mapState.currentIndex] !== undefined) {
                mapState.data[row.country_code] = {
                    value: row[mapState.currentIndex],
                    name: row.country_name,
                    continent: state.continentMap[row.country_code]
                };
            }
        });

        console.log(`Map data loaded for ${mapState.currentYear}/${mapState.currentIndex}: ${Object.keys(mapState.data).length} countries`);
    } catch (error) {
        console.error('Error loading map data:', error);
        mapState.data = {};
    }
}

// Get country code from GeoJSON properties
function getCountryCodeFromFeature(feature) {
    // Check for ISO A3 code in various places
    // First check the id (we set this in loadGeoData)
    if (feature.id && typeof feature.id === 'string' && feature.id.length === 3) {
        return feature.id;
    }

    // Check properties for ISO A3 codes
    if (feature.properties) {
        if (feature.properties.ISO_A3 && feature.properties.ISO_A3 !== '-99') {
            return feature.properties.ISO_A3;
        }
        if (feature.properties.iso_a3) return feature.properties.iso_a3;
        if (feature.properties.ADM0_A3) return feature.properties.ADM0_A3;
        if (feature.properties.adm0_a3) return feature.properties.adm0_a3;
        if (feature.properties.SOV_A3) return feature.properties.SOV_A3;
    }

    // Fallback: map numeric codes to ISO alpha-3 codes (for world-atlas TopoJSON)
    const numericCode = feature.id || (feature.properties && feature.properties.id);
    const numericToAlpha3 = {
        '4': 'AFG', '8': 'ALB', '12': 'DZA', '20': 'AND', '24': 'AGO', '28': 'ATG', '32': 'ARG',
        '51': 'ARM', '36': 'AUS', '40': 'AUT', '31': 'AZE', '44': 'BHS', '48': 'BHR', '50': 'BGD',
        '52': 'BRB', '112': 'BLR', '56': 'BEL', '84': 'BLZ', '204': 'BEN', '64': 'BTN', '68': 'BOL',
        '70': 'BIH', '72': 'BWA', '76': 'BRA', '96': 'BRN', '100': 'BGR', '854': 'BFA', '108': 'BDI',
        '116': 'KHM', '120': 'CMR', '124': 'CAN', '132': 'CPV', '140': 'CAF', '148': 'TCD',
        '152': 'CHL', '156': 'CHN', '170': 'COL', '174': 'COM', '178': 'COG', '180': 'COD',
        '188': 'CRI', '384': 'CIV', '191': 'HRV', '192': 'CUB', '196': 'CYP', '203': 'CZE',
        '208': 'DNK', '262': 'DJI', '212': 'DMA', '214': 'DOM', '218': 'ECU', '818': 'EGY',
        '222': 'SLV', '226': 'GNQ', '232': 'ERI', '233': 'EST', '231': 'ETH', '242': 'FJI',
        '246': 'FIN', '250': 'FRA', '266': 'GAB', '270': 'GMB', '268': 'GEO', '276': 'DEU',
        '288': 'GHA', '300': 'GRC', '308': 'GRD', '320': 'GTM', '324': 'GIN', '624': 'GNB',
        '328': 'GUY', '332': 'HTI', '340': 'HND', '348': 'HUN', '352': 'ISL', '356': 'IND',
        '360': 'IDN', '364': 'IRN', '368': 'IRQ', '372': 'IRL', '376': 'ISR', '380': 'ITA',
        '388': 'JAM', '392': 'JPN', '400': 'JOR', '398': 'KAZ', '404': 'KEN', '296': 'KIR',
        '408': 'PRK', '410': 'KOR', '414': 'KWT', '417': 'KGZ', '418': 'LAO', '428': 'LVA',
        '422': 'LBN', '426': 'LSO', '430': 'LBR', '434': 'LBY', '438': 'LIE', '440': 'LTU',
        '442': 'LUX', '807': 'MKD', '450': 'MDG', '454': 'MWI', '458': 'MYS', '462': 'MDV',
        '466': 'MLI', '470': 'MLT', '584': 'MHL', '478': 'MRT', '480': 'MUS', '484': 'MEX',
        '583': 'FSM', '498': 'MDA', '492': 'MCO', '496': 'MNG', '499': 'MNE', '504': 'MAR',
        '508': 'MOZ', '104': 'MMR', '516': 'NAM', '520': 'NRU', '524': 'NPL', '528': 'NLD',
        '554': 'NZL', '558': 'NIC', '562': 'NER', '566': 'NGA', '578': 'NOR', '512': 'OMN',
        '586': 'PAK', '585': 'PLW', '591': 'PAN', '598': 'PNG', '600': 'PRY', '604': 'PER',
        '608': 'PHL', '616': 'POL', '620': 'PRT', '634': 'QAT', '642': 'ROU', '643': 'RUS',
        '646': 'RWA', '659': 'KNA', '662': 'LCA', '670': 'VCT', '882': 'WSM', '674': 'SMR',
        '678': 'STP', '682': 'SAU', '686': 'SEN', '688': 'SRB', '690': 'SYC', '694': 'SLE',
        '702': 'SGP', '703': 'SVK', '705': 'SVN', '90': 'SLB', '706': 'SOM', '710': 'ZAF',
        '728': 'SSD', '724': 'ESP', '144': 'LKA', '729': 'SDN', '740': 'SUR', '748': 'SWZ',
        '752': 'SWE', '756': 'CHE', '760': 'SYR', '762': 'TJK', '834': 'TZA', '764': 'THA',
        '626': 'TLS', '768': 'TGO', '776': 'TON', '780': 'TTO', '788': 'TUN', '792': 'TUR',
        '795': 'TKM', '798': 'TUV', '800': 'UGA', '804': 'UKR', '784': 'ARE', '826': 'GBR',
        '840': 'USA', '858': 'URY', '860': 'UZB', '548': 'VUT', '862': 'VEN', '704': 'VNM',
        '887': 'YEM', '894': 'ZMB', '716': 'ZWE', '275': 'PSE', '-99': 'CYN', '732': 'ESH'
    };

    return numericToAlpha3[String(numericCode)] || null;
}

// Get color for a value
function getColorForValue(value, min, max) {
    if (value === null || value === undefined || isNaN(value)) {
        return null;
    }

    // Normalize value to 0-1 range
    const range = max - min;
    if (range === 0) return d3.interpolateViridis(0.5);

    const normalized = (value - min) / range;

    // Use Viridis color scale (perceptually uniform, colorblind-friendly)
    return d3.interpolateViridis(normalized);
}

// Render the map
function renderMap() {
    const container = document.getElementById('worldMap');
    if (!container || !mapState.geoData) {
        console.log('Cannot render map: container or geoData missing');
        return;
    }

    // Clear previous content
    container.innerHTML = '';

    // Get container dimensions
    const containerRect = container.getBoundingClientRect();
    const width = containerRect.width || 800;
    const height = containerRect.height || 500;

    // Create SVG
    const svg = d3.select('#worldMap')
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    mapState.svg = svg;

    // Filter features based on selected continent
    // Exclude Antarctica from the map
    let featuresToDisplay = mapState.geoData.features.filter(feature => {
        const countryCode = getCountryCodeFromFeature(feature);
        return countryCode !== 'ATA';
    });
    let featuresToFit = {
        type: 'FeatureCollection',
        features: featuresToDisplay
    };

    if (mapState.currentContinent !== 'all') {
        // Get country codes for the selected continent
        const continentCountryCodes = new Set();
        state.countries.forEach(country => {
            if (country.continent === mapState.currentContinent) {
                continentCountryCodes.add(country.country_code);
            }
        });

        console.log(`Continent ${mapState.currentContinent}: ${continentCountryCodes.size} countries in database`);

        // Filter features to only include countries from selected continent (excluding Antarctica)
        featuresToDisplay = mapState.geoData.features.filter(feature => {
            const countryCode = getCountryCodeFromFeature(feature);
            return countryCode !== 'ATA' && continentCountryCodes.has(countryCode);
        });

        console.log(`Filtered to ${featuresToDisplay.length} GeoJSON features`);

        // If no features match, fall back to world view (still excluding Antarctica)
        if (featuresToDisplay.length === 0) {
            console.warn('No GeoJSON features match continent filter, showing world view');
            featuresToDisplay = mapState.geoData.features.filter(feature => {
                const countryCode = getCountryCodeFromFeature(feature);
                return countryCode !== 'ATA';
            });
            featuresToFit = {
                type: 'FeatureCollection',
                features: featuresToDisplay
            };
        } else {
            // Create a GeoJSON FeatureCollection for fitSize
            featuresToFit = {
                type: 'FeatureCollection',
                features: featuresToDisplay
            };
        }
    }

    // Create Equal Earth projection
    // Use fitExtent to automatically scale and center the map with asymmetric padding
    // Less padding at top, more at bottom to accommodate legend with index name
    const paddingTop = 15;
    const paddingBottom = 50;
    const paddingHorizontal = 30;
    const projection = d3.geoEqualEarth()
        .fitExtent([[paddingHorizontal, paddingTop], [width - paddingHorizontal, height - paddingBottom]], featuresToFit);

    mapState.projection = projection;

    // Create path generator
    const path = d3.geoPath().projection(projection);
    mapState.path = path;

    // Add ocean background
    svg.append('rect')
        .attr('class', 'ocean')
        .attr('width', width)
        .attr('height', height)
        .attr('fill', getComputedStyle(document.body).getPropertyValue('--bg-primary'));

    // Add graticule (grid lines) - only for world view
    if (mapState.currentContinent === 'all') {
        const graticule = d3.geoGraticule()
            .step([20, 20]);

        svg.append('path')
            .datum(graticule)
            .attr('class', 'graticule')
            .attr('d', path)
            .attr('fill', 'none')
            .attr('stroke', getComputedStyle(document.body).getPropertyValue('--border-color'))
            .attr('stroke-width', 0.3)
            .attr('stroke-opacity', 0.4);
    }

    // Use global min/max values for consistent color scale across all years
    // Falls back to current year's values if global values not available
    let minValue, maxValue;
    if (mapState.globalMinValue !== null && mapState.globalMaxValue !== null) {
        minValue = mapState.globalMinValue;
        maxValue = mapState.globalMaxValue;
    } else {
        // Fallback: calculate from current year's data
        let values;
        if (mapState.currentContinent !== 'all') {
            values = Object.values(mapState.data)
                .filter(d => d.continent === mapState.currentContinent && d.value !== null && !isNaN(d.value))
                .map(d => d.value);
        } else {
            values = Object.values(mapState.data).map(d => d.value).filter(v => v !== null && !isNaN(v));
        }
        minValue = values.length > 0 ? Math.min(...values) : 0;
        maxValue = values.length > 0 ? Math.max(...values) : 100;
    }

    console.log(`Map render: ${featuresToDisplay.length} features, ${Object.keys(mapState.data).length} data points, color scale range: [${minValue}, ${maxValue}] (global)`);

    // Debug: check a sample of matches
    let matchCount = 0;
    featuresToDisplay.slice(0, 10).forEach(f => {
        const code = getCountryCodeFromFeature(f);
        const data = mapState.data[code];
        if (data) matchCount++;
    });
    console.log(`Sample match: ${matchCount}/10 features have data`);

    // Create tooltip
    let tooltip = d3.select('.map-tooltip');
    if (tooltip.empty()) {
        tooltip = d3.select('body')
            .append('div')
            .attr('class', 'map-tooltip')
            .style('opacity', 0);
    }

    // Get current index info for tooltip
    const currentIndexInfo = state.indexes.find(i => i.id === mapState.currentIndex);
    const indexLabel = currentIndexInfo ? getIndexLabel(currentIndexInfo) : mapState.currentIndex;

    // Draw countries (only filtered features)
    svg.selectAll('.country')
        .data(featuresToDisplay)
        .enter()
        .append('path')
        .attr('class', d => {
            const countryCode = getCountryCodeFromFeature(d);
            const countryData = mapState.data[countryCode];

            let classes = 'country';
            if (!countryData || countryData.value === null) {
                classes += ' no-data';
            }
            return classes;
        })
        .attr('d', path)
        .attr('fill', d => {
            const countryCode = getCountryCodeFromFeature(d);
            const countryData = mapState.data[countryCode];

            if (!countryData || countryData.value === null || isNaN(countryData.value)) {
                return getComputedStyle(document.body).getPropertyValue('--bg-tertiary');
            }

            return getColorForValue(countryData.value, minValue, maxValue);
        })
        .attr('stroke', getComputedStyle(document.body).getPropertyValue('--border-color'))
        .attr('stroke-width', 0.5)
        .on('mouseover', function(event, d) {
            const countryCode = getCountryCodeFromFeature(d);
            const countryData = mapState.data[countryCode];

            d3.select(this)
                .attr('stroke-width', 1.5)
                .attr('stroke', getComputedStyle(document.body).getPropertyValue('--text-primary'));

            // Get country name from our data or from feature properties
            let countryName = countryData ? countryData.name :
                             (state.countryMap[countryCode] ? state.countryMap[countryCode].name :
                             (d.properties && d.properties.name) || countryCode || 'Unknown');

            let tooltipContent = `<div class="map-tooltip-country">${countryName}</div>`;

            if (countryData && countryData.value !== null && !isNaN(countryData.value)) {
                // Format the value
                const decimals = currentIndexInfo ? currentIndexInfo.decimals : 2;
                const formattedValue = countryData.value.toLocaleString('en-US', {
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals
                });
                tooltipContent += `<div class="map-tooltip-value">${indexLabel}: ${formattedValue}</div>`;
            } else {
                tooltipContent += `<div class="map-tooltip-nodata">No data available</div>`;
            }

            tooltip.html(tooltipContent)
                .style('left', (event.clientX + 15) + 'px')
                .style('top', (event.clientY - 10) + 'px')
                .style('opacity', 1);
        })
        .on('mousemove', function(event) {
            tooltip
                .style('left', (event.clientX + 15) + 'px')
                .style('top', (event.clientY - 10) + 'px');
        })
        .on('mouseout', function() {
            d3.select(this)
                .attr('stroke-width', 0.5)
                .attr('stroke', getComputedStyle(document.body).getPropertyValue('--border-color'));

            tooltip.style('opacity', 0);
        });

    // Update legend
    updateMapLegend(minValue, maxValue, indexLabel);
}

// Update map legend
function updateMapLegend(minValue, maxValue, indexLabel) {
    const legendContainer = document.getElementById('mapLegend');
    if (!legendContainer) return;

    // Format values
    const currentIndexInfo = state.indexes.find(i => i.id === mapState.currentIndex);
    const decimals = currentIndexInfo ? currentIndexInfo.decimals : 2;

    const formatValue = (val) => val.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });

    // Create gradient for legend
    const gradientId = 'mapLegendGradient';

    legendContainer.innerHTML = `
        <div class="map-legend-row">
            <span class="map-legend-label min">${formatValue(minValue)}</span>
            <svg width="200" height="12" style="display: block;">
                <defs>
                    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:${d3.interpolateViridis(0)}"/>
                        <stop offset="25%" style="stop-color:${d3.interpolateViridis(0.25)}"/>
                        <stop offset="50%" style="stop-color:${d3.interpolateViridis(0.5)}"/>
                        <stop offset="75%" style="stop-color:${d3.interpolateViridis(0.75)}"/>
                        <stop offset="100%" style="stop-color:${d3.interpolateViridis(1)}"/>
                    </linearGradient>
                </defs>
                <rect width="200" height="12" fill="url(#${gradientId})" rx="2"/>
            </svg>
            <span class="map-legend-label max">${formatValue(maxValue)}</span>
        </div>
        <span class="map-legend-index-name hoverable">${indexLabel}</span>
    `;

    // Attach tooltip events to the index name
    const indexNameEl = legendContainer.querySelector('.map-legend-index-name');
    if (indexNameEl && currentIndexInfo) {
        indexNameEl.addEventListener('mouseenter', (e) => showAxisLabelTooltip(e, currentIndexInfo));
        indexNameEl.addEventListener('mousemove', (e) => showAxisLabelTooltip(e, currentIndexInfo));
        indexNameEl.addEventListener('mouseleave', hideAxisLabelTooltip);
    }
}

// Handle window resize with debouncing for better performance
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        console.log('Window resized, updating plots');
        updatePlot(1);
        if (isSecondPlotEnabled()) {
            ensureSecondPlotInitialized();
            if (isSecondPlotActive()) {
                updatePlot(2);
            }
        }

        // Reposition year inputs
        ['1', '2'].forEach(num => {
            const slider = document.getElementById(`yearSlider${num}`);
            const yearInput = document.getElementById(`yearInput${num}`);
            updateYearInputPosition(slider, yearInput);
        });

        // Reposition raw data year input
        const rawDataSlider = document.getElementById('rawDataYearSlider');
        const rawDataYearInput = document.getElementById('rawDataYearInput');
        updateYearInputPosition(rawDataSlider, rawDataYearInput);
        updateRawDataStickyDivider();
        updateRawDataNameColumnWidth();

        // Update map if initialized
        if (mapState.initialized) {
            renderMap();
        }

        // Update timeline plots if initialized
        if (timelineTabState.initialized && timelineTabState.selectedCountries.size > 0 && timelineTabState.selectedIndexes.size > 0) {
            renderTimelinePlots();
        }
    }, 250); // Wait 250ms after last resize event
});

// Handle orientation change on mobile devices
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        console.log('Orientation changed, updating plots');
        updatePlot(1);
        if (isSecondPlotEnabled()) {
            ensureSecondPlotInitialized();
            if (isSecondPlotActive()) {
                updatePlot(2);
            }
        }

        // Reposition year inputs
        ['1', '2'].forEach(num => {
            const slider = document.getElementById(`yearSlider${num}`);
            const yearInput = document.getElementById(`yearInput${num}`);
            updateYearInputPosition(slider, yearInput);
        });

        // Reposition raw data year input
        const rawDataSlider = document.getElementById('rawDataYearSlider');
        const rawDataYearInput = document.getElementById('rawDataYearInput');
        updateYearInputPosition(rawDataSlider, rawDataYearInput);
        updateRawDataStickyDivider();
        updateRawDataNameColumnWidth();

        // Update map if initialized
        if (mapState.initialized) {
            renderMap();
        }

        // Update timeline plots if initialized
        if (timelineTabState.initialized && timelineTabState.selectedCountries.size > 0 && timelineTabState.selectedIndexes.size > 0) {
            renderTimelinePlots();
        }
    }, 300); // Wait for orientation change to complete
});

// ============================================
// TIMELINE TAB FUNCTIONALITY
// ============================================

// Timeline tab state
const timelineTabState = {
    initialized: false,
    isLoading: false,
    selectedCountries: new Set(),
    selectedIndexes: new Set(),
    data: [],
    allCountries: [],
    collapsedContinents: new Set(),
    // Zoom state per chart (keyed by indexId)
    zoomState: {}
};

// Country colors for multi-line plots
const countryColors = [
    '#2563eb', // Blue
    '#dc2626', // Red
    '#16a34a', // Green
    '#9333ea', // Purple
    '#ea580c', // Orange
    '#0891b2', // Cyan
    '#c026d3', // Fuchsia
    '#65a30d', // Lime
    '#0d9488', // Teal
    '#e11d48', // Rose
];

// Initialize Timeline tab
async function initializeTimelineTab() {
    if (timelineTabState.initialized) {
        // If already initialized, just re-render plots if data exists
        if (timelineTabState.selectedCountries.size > 0 && timelineTabState.selectedIndexes.size > 0) {
            renderTimelinePlots();
        }
        return;
    }

    console.log('Initializing Timeline tab...');

    // Initialize countries list
    timelineTabState.allCountries = state.countries
        .map(c => ({
            code: c.country_code,
            name: (c.country_name || '').trim(),
            label: buildCountryLabel(c.country_name, c.flag),
            continent: c.continent
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    // Get all continents and collapse them by default
    const allContinents = [...new Set(timelineTabState.allCountries.map(c => c.continent || 'Other'))];
    timelineTabState.collapsedContinents = new Set(allContinents);

    // Set default selected countries
    timelineTabState.selectedCountries = new Set(['POL', 'DEU', 'GBR', 'JPN']);

    // Set default selected indexes: GDP per capita (PPP), Life Evaluation Index, Press Freedom Index
    timelineTabState.selectedIndexes = new Set(['gdp_ppp', 'life_satisfaction_index', 'press_freedom']);

    // Set up country multiselect
    setupTimelineCountryMultiselect();

    // Set up indexes multiselect
    setupTimelineIndexesMultiselect();

    window.addEventListener('resize', updateTimelineDropdownWidth);

    // Mark as initialized
    timelineTabState.initialized = true;

    // Load data and show initial state
    await loadTimelineData();

    console.log('Timeline tab initialized');
}

// Get countries grouped by continent for Timeline tab
function getTimelineTabByContinent() {
    const continents = [];
    const continentMap = new Map();

    timelineTabState.allCountries.forEach(country => {
        const continent = country.continent || 'Other';
        if (!continentMap.has(continent)) {
            continentMap.set(continent, []);
            continents.push(continent);
        }
        continentMap.get(continent).push(country);
    });

    continents.sort();

    return continents.map(cont => ({
        continent: cont,
        countries: continentMap.get(cont)
    }));
}

// Setup country multiselect for Timeline tab
function setupTimelineCountryMultiselect() {
    const container = document.getElementById('timelineCountryMultiselect');
    const searchInput = document.getElementById('timelineCountrySearch');
    const dropdown = document.getElementById('timelineCountryDropdown');
    const selectAllBtn = document.getElementById('timelineCountrySelectAll');
    const unselectAllBtn = document.getElementById('timelineCountryUnselectAll');

    if (!container) return;

    // Populate options
    renderTimelineCountryOptions();

    // Click on input wrapper toggles dropdown
    container.querySelector('.multiselect-input-wrapper').addEventListener('click', () => {
        const isOpen = container.classList.contains('open');
        if (isOpen) {
            container.classList.remove('open');
            dropdown.classList.remove('open');
        } else {
            container.classList.add('open');
            dropdown.classList.add('open');
            searchInput.focus();
            updateTimelineDropdownWidth();
        }
    });

    // Search filtering
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        filterTimelineCountryOptions(searchTerm);
    });

    // Select all (visible/filtered items)
    selectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const searchTerm = searchInput.value.toLowerCase();
        timelineTabState.allCountries.forEach(country => {
            const name = country.name;
            if (!searchTerm || name.toLowerCase().includes(searchTerm) || country.code.toLowerCase().includes(searchTerm)) {
                timelineTabState.selectedCountries.add(country.code);
            }
        });
        renderTimelineCountryOptions();
        renderTimelineCountryTags();
        loadTimelineData();
    });

    // Unselect all
    unselectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        timelineTabState.selectedCountries = new Set();
        renderTimelineCountryOptions();
        renderTimelineCountryTags();
        updateTimelineDisplay();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            container.classList.remove('open');
            dropdown.classList.remove('open');
            searchInput.value = '';
            filterTimelineCountryOptions('');
            updateTimelineDropdownWidth();
        }
    });

    // Initial render
    renderTimelineCountryTags();
}

// Render country multiselect options grouped by continent
function renderTimelineCountryOptions() {
    const optionsContainer = document.getElementById('timelineCountryOptions');
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';

    const groupedCountries = getTimelineTabByContinent();

    groupedCountries.forEach((group) => {
        const isCollapsed = timelineTabState.collapsedContinents.has(group.continent);
        const countryCodes = group.countries.map(c => c.code);
        const selectedCount = countryCodes.filter(code => timelineTabState.selectedCountries.has(code)).length;

        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'multiselect-continent-group';
        groupWrapper.dataset.continent = group.continent;

        const allSelected = selectedCount === group.countries.length;
        const noneSelected = selectedCount === 0;

        const header = document.createElement('div');
        header.className = `multiselect-category-header multiselect-collapsible-header ${isCollapsed ? 'collapsed' : ''}`;
        header.innerHTML = `
            <button type="button" class="multiselect-collapse-btn" title="${isCollapsed ? 'Expand' : 'Collapse'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <span class="multiselect-category-title">${group.continent} <span class="multiselect-category-count">(${selectedCount}/${group.countries.length})</span></span>
            <div class="multiselect-category-actions">
                <button type="button" class="multiselect-category-btn multiselect-category-select ${allSelected ? 'inactive' : ''}" title="Select all ${group.continent}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
                </button>
                <button type="button" class="multiselect-category-btn multiselect-category-clear ${noneSelected ? 'inactive' : ''}" title="Clear all ${group.continent}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                </button>
            </div>
        `;

        // Collapse/expand toggle - clicking anywhere on header (except action buttons)
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            if (timelineTabState.collapsedContinents.has(group.continent)) {
                timelineTabState.collapsedContinents.delete(group.continent);
            } else {
                timelineTabState.collapsedContinents.add(group.continent);
            }
            renderTimelineCountryOptions();
        });

        // Select all for this continent
        const selectBtn = header.querySelector('.multiselect-category-select');
        selectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            countryCodes.forEach(code => timelineTabState.selectedCountries.add(code));
            renderTimelineCountryOptions();
            renderTimelineCountryTags();
            loadTimelineData();
        });

        // Clear all for this continent
        const clearBtn = header.querySelector('.multiselect-category-clear');
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            countryCodes.forEach(code => timelineTabState.selectedCountries.delete(code));
            renderTimelineCountryOptions();
            renderTimelineCountryTags();
            loadTimelineData();
        });

        groupWrapper.appendChild(header);

        // Create collapsible container for countries
        const countryList = document.createElement('div');
        countryList.className = `multiselect-collapsible-content ${isCollapsed ? 'collapsed' : ''}`;

        group.countries.forEach(country => {
            const isSelected = timelineTabState.selectedCountries.has(country.code);

            const option = document.createElement('div');
            option.className = `multiselect-option ${isSelected ? 'selected' : ''}`;
            option.dataset.value = country.code;
            option.dataset.continent = group.continent;
            option.innerHTML = `
                <input type="checkbox" class="multiselect-checkbox" ${isSelected ? 'checked' : ''}>
                <span class="multiselect-option-text">${country.label}</span>
            `;

            option.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleTimelineCountrySelection(country.code);
            });

            countryList.appendChild(option);
        });

        groupWrapper.appendChild(countryList);
        optionsContainer.appendChild(groupWrapper);
    });

    updateTimelineDropdownWidth();
}

// Filter country options
function filterTimelineCountryOptions(searchTerm) {
    const groups = document.querySelectorAll('#timelineCountryOptions .multiselect-continent-group');

    groups.forEach(group => {
        const content = group.querySelector('.multiselect-collapsible-content');
        const options = content.querySelectorAll('.multiselect-option');
        let hasVisibleOptions = false;

        options.forEach(option => {
            const country = timelineTabState.allCountries.find(c => c.code === option.dataset.value);
            if (!country) return;

            const matchesSearch = !searchTerm ||
                country.name.toLowerCase().includes(searchTerm) ||
                country.code.toLowerCase().includes(searchTerm);

            option.classList.toggle('hidden', !matchesSearch);
            if (matchesSearch) hasVisibleOptions = true;
        });

        group.classList.toggle('hidden', !hasVisibleOptions);

        // Auto-expand when searching
        if (searchTerm && hasVisibleOptions) {
            content.classList.remove('collapsed');
            group.querySelector('.multiselect-collapsible-header').classList.remove('collapsed');
        }
    });
}

// Toggle country selection
function toggleTimelineCountrySelection(countryCode) {
    if (timelineTabState.selectedCountries.has(countryCode)) {
        timelineTabState.selectedCountries.delete(countryCode);
    } else {
        timelineTabState.selectedCountries.add(countryCode);
    }
    renderTimelineCountryOptions();
    renderTimelineCountryTags();
    loadTimelineData();
}

// Render country tags
function renderTimelineCountryTags() {
    const tagsContainer = document.getElementById('timelineCountryTags');
    if (!tagsContainer) return;

    tagsContainer.innerHTML = '';

    if (timelineTabState.selectedCountries.size === 0) {
        return;
    }

    // If all countries are selected, show "All" tag
    if (timelineTabState.selectedCountries.size === timelineTabState.allCountries.length) {
        const allTag = document.createElement('div');
        allTag.className = 'multiselect-tag';
        allTag.innerHTML = `<span class="multiselect-tag-text">${t('raw-data-all-countries')}</span>`;
        tagsContainer.appendChild(allTag);
        return;
    }

    const selectedArray = Array.from(timelineTabState.selectedCountries);

    const createTagEl = (countryCode) => {
        const country = timelineTabState.allCountries.find(c => c.code === countryCode);
        const label = country ? country.label : countryCode;
        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `<span class="multiselect-tag-text">${label}</span><button type="button" class="multiselect-tag-remove">&times;</button>`;
        return tag;
    };

    const createMoreTagEl = (count) => {
        const tag = document.createElement('div');
        tag.className = 'multiselect-tag multiselect-tag--more';
        tag.innerHTML = `<span class="multiselect-tag-text">+${count}</span>`;
        return tag;
    };

    const fittingCount = calculateFittingTags(tagsContainer, selectedArray, createTagEl, createMoreTagEl);
    const displayedCountries = selectedArray.slice(0, fittingCount);

    displayedCountries.forEach(countryCode => {
        const country = timelineTabState.allCountries.find(c => c.code === countryCode);
        const label = country ? country.label : countryCode;

        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `
            <span class="multiselect-tag-text">${label}</span>
            <button type="button" class="multiselect-tag-remove" data-value="${countryCode}">&times;</button>
        `;

        tag.querySelector('.multiselect-tag-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            timelineTabState.selectedCountries.delete(countryCode);
            renderTimelineCountryOptions();
            renderTimelineCountryTags();
            loadTimelineData();
        });

        tagsContainer.appendChild(tag);
    });

    if (selectedArray.length > fittingCount) {
        const moreTag = document.createElement('div');
        moreTag.className = 'multiselect-tag multiselect-tag--more';
        moreTag.innerHTML = `<span class="multiselect-tag-text">+${selectedArray.length - fittingCount}</span>`;
        tagsContainer.appendChild(moreTag);
    }
}

// Setup timeline indexes multiselect
function setupTimelineIndexesMultiselect() {
    const container = document.getElementById('timelineIndexesMultiselect');
    const searchInput = document.getElementById('timelineIndexesSearch');
    const dropdown = document.getElementById('timelineIndexesDropdown');
    const selectAllBtn = document.getElementById('timelineIndexesSelectAll');
    const unselectAllBtn = document.getElementById('timelineIndexesUnselectAll');

    if (!container) return;

    // Populate options
    renderTimelineIndexesOptions();

    // Click on input wrapper toggles dropdown
    container.querySelector('.multiselect-input-wrapper').addEventListener('click', () => {
        const isOpen = container.classList.contains('open');
        if (isOpen) {
            container.classList.remove('open');
            dropdown.classList.remove('open');
        } else {
            container.classList.add('open');
            dropdown.classList.add('open');
            searchInput.focus();
        }
    });

    // Search filtering
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        filterTimelineIndexesOptions(searchTerm);
    });

    // Select all
    selectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        timelineTabState.selectedIndexes = new Set(state.indexes.map(idx => idx.id));
        renderTimelineIndexesOptions();
        renderTimelineIndexesTags();
        loadTimelineData();
    });

    // Unselect all
    unselectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        timelineTabState.selectedIndexes = new Set();
        renderTimelineIndexesOptions();
        renderTimelineIndexesTags();
        loadTimelineData();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            container.classList.remove('open');
            dropdown.classList.remove('open');
            searchInput.value = '';
            filterTimelineIndexesOptions('');
        }
    });

    // Initial render
    renderTimelineIndexesTags();
}

// Render timeline indexes options grouped by category
function renderTimelineIndexesOptions() {
    const optionsContainer = document.getElementById('timelineIndexesOptions');
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';

    // Get indexes grouped by category
    const groupedIndexes = getIndexesByCategory();

    groupedIndexes.forEach((group) => {
        const categoryIndexIds = group.indexes.map(idx => idx.id);
        const selectedCount = categoryIndexIds.filter(id => timelineTabState.selectedIndexes.has(id)).length;
        const allSelected = selectedCount === group.indexes.length;
        const noneSelected = selectedCount === 0;

        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'multiselect-index-group';
        groupWrapper.dataset.category = group.category;

        const header = document.createElement('div');
        header.className = 'multiselect-category-header';
        header.innerHTML = `
            <span class="multiselect-category-title">${group.category} <span class="multiselect-category-count">(${selectedCount}/${group.indexes.length})</span></span>
            <div class="multiselect-category-actions">
                <button type="button" class="multiselect-category-btn multiselect-category-select ${allSelected ? 'inactive' : ''}" title="Select all ${group.category}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
                </button>
                <button type="button" class="multiselect-category-btn multiselect-category-clear ${noneSelected ? 'inactive' : ''}" title="Clear all ${group.category}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                </button>
            </div>
        `;

        const selectBtn = header.querySelector('.multiselect-category-select');
        const clearBtn = header.querySelector('.multiselect-category-clear');

        selectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            categoryIndexIds.forEach(id => timelineTabState.selectedIndexes.add(id));
            renderTimelineIndexesOptions();
            renderTimelineIndexesTags();
            loadTimelineData();
        });

        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            categoryIndexIds.forEach(id => timelineTabState.selectedIndexes.delete(id));
            renderTimelineIndexesOptions();
            renderTimelineIndexesTags();
            loadTimelineData();
        });

        groupWrapper.appendChild(header);

        const indexList = document.createElement('div');
        indexList.className = 'multiselect-index-list';

        group.indexes.forEach(indexData => {
            const label = getIndexLabel(indexData) || indexData.id;
            const isSelected = timelineTabState.selectedIndexes.has(indexData.id);

            const option = document.createElement('div');
            option.className = `multiselect-option ${isSelected ? 'selected' : ''}`;
            option.dataset.value = indexData.id;
            option.dataset.category = group.category;
            option.innerHTML = `
                <input type="checkbox" class="multiselect-checkbox" ${isSelected ? 'checked' : ''}>
                <span class="multiselect-option-text">${label}</span>
            `;

            option.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleTimelineIndexSelection(indexData.id);
            });

            indexList.appendChild(option);
        });

        groupWrapper.appendChild(indexList);
        optionsContainer.appendChild(groupWrapper);
    });
}

// Filter timeline indexes options
function filterTimelineIndexesOptions(searchTerm) {
    const groups = document.querySelectorAll('#timelineIndexesOptions .multiselect-index-group');

    groups.forEach(group => {
        const options = group.querySelectorAll('.multiselect-option');
        let hasVisibleOptions = false;

        options.forEach(option => {
            const text = option.querySelector('.multiselect-option-text').textContent.toLowerCase();
            const matches = !searchTerm || text.includes(searchTerm);
            option.classList.toggle('hidden', !matches);
            if (matches) hasVisibleOptions = true;
        });

        group.classList.toggle('hidden', !hasVisibleOptions);
    });
}

// Toggle timeline index selection
function toggleTimelineIndexSelection(indexId) {
    if (timelineTabState.selectedIndexes.has(indexId)) {
        timelineTabState.selectedIndexes.delete(indexId);
    } else {
        timelineTabState.selectedIndexes.add(indexId);
    }
    renderTimelineIndexesOptions();
    renderTimelineIndexesTags();
    loadTimelineData();
}

// Render timeline indexes tags
function renderTimelineIndexesTags() {
    const tagsContainer = document.getElementById('timelineIndexesTags');
    if (!tagsContainer) return;

    tagsContainer.innerHTML = '';

    if (timelineTabState.selectedIndexes.size === 0) {
        return;
    }

    // If all indexes are selected, show "All" tag
    if (timelineTabState.selectedIndexes.size === state.indexes.length) {
        const allTag = document.createElement('div');
        allTag.className = 'multiselect-tag';
        allTag.innerHTML = `<span class="multiselect-tag-text">${t('raw-data-all-indexes')}</span>`;
        tagsContainer.appendChild(allTag);
        return;
    }

    const selectedArray = Array.from(timelineTabState.selectedIndexes);

    const createTagEl = (indexId) => {
        const index = state.indexes.find(i => i.id === indexId);
        const label = getIndexLabel(index) || indexId;
        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `<span class="multiselect-tag-text">${label}</span><button type="button" class="multiselect-tag-remove">&times;</button>`;
        return tag;
    };

    const createMoreTagEl = (count) => {
        const tag = document.createElement('div');
        tag.className = 'multiselect-tag multiselect-tag--more';
        tag.innerHTML = `<span class="multiselect-tag-text">+${count}</span>`;
        return tag;
    };

    const fittingCount = calculateFittingTags(tagsContainer, selectedArray, createTagEl, createMoreTagEl);
    const displayedIndexes = selectedArray.slice(0, fittingCount);

    displayedIndexes.forEach(indexId => {
        const index = state.indexes.find(i => i.id === indexId);
        const label = getIndexLabel(index) || indexId;

        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `
            <span class="multiselect-tag-text">${label}</span>
            <button type="button" class="multiselect-tag-remove" data-value="${indexId}">&times;</button>
        `;

        tag.querySelector('.multiselect-tag-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            timelineTabState.selectedIndexes.delete(indexId);
            renderTimelineIndexesOptions();
            renderTimelineIndexesTags();
            loadTimelineData();
        });

        tagsContainer.appendChild(tag);
    });

    if (selectedArray.length > fittingCount) {
        const moreTag = document.createElement('div');
        moreTag.className = 'multiselect-tag multiselect-tag--more';
        moreTag.innerHTML = `<span class="multiselect-tag-text">+${selectedArray.length - fittingCount}</span>`;
        tagsContainer.appendChild(moreTag);
    }
}

// Load timeline data from API
async function loadTimelineData() {
    if (timelineTabState.selectedCountries.size === 0 || timelineTabState.selectedIndexes.size === 0) {
        timelineTabState.data = [];
        timelineTabState.zoomState = {}; // Clear zoom state when no selection
        updateTimelineDisplay();
        return;
    }

    const loadingEl = document.getElementById('timelineLoading');
    const noDataEl = document.getElementById('timelineNoData');
    const noSelectionEl = document.getElementById('timelineNoSelection');
    const plotsEl = document.getElementById('timelinePlots');

    if (loadingEl) loadingEl.style.display = 'flex';
    if (noDataEl) noDataEl.style.display = 'none';
    if (noSelectionEl) noSelectionEl.style.display = 'none';
    if (plotsEl) plotsEl.innerHTML = '';

    // Clear zoom state when loading new data (country selection changed)
    timelineTabState.zoomState = {};

    timelineTabState.isLoading = true;

    try {
        const countries = Array.from(timelineTabState.selectedCountries).join(',');
        const indexes = Array.from(timelineTabState.selectedIndexes).join(',');
        const url = `/api/country-data?countries=${countries}&indexes=${indexes}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        timelineTabState.data = await response.json();
        console.log(`Loaded ${timelineTabState.data.length} data points for timeline tab`);
    } catch (error) {
        console.error('Error loading countries data:', error);
        timelineTabState.data = [];
    } finally {
        timelineTabState.isLoading = false;
        if (loadingEl) loadingEl.style.display = 'none';
        updateTimelineDisplay();
    }
}

// Update timeline display
function updateTimelineDisplay() {
    const loadingEl = document.getElementById('timelineLoading');
    const noDataEl = document.getElementById('timelineNoData');
    const noSelectionEl = document.getElementById('timelineNoSelection');
    const plotsEl = document.getElementById('timelinePlots');

    if (loadingEl) loadingEl.style.display = 'none';

    if (timelineTabState.selectedCountries.size === 0 || timelineTabState.selectedIndexes.size === 0) {
        if (noSelectionEl) noSelectionEl.style.display = 'flex';
        if (noDataEl) noDataEl.style.display = 'none';
        if (plotsEl) plotsEl.innerHTML = '';
        return;
    }

    if (noSelectionEl) noSelectionEl.style.display = 'none';

    if (timelineTabState.data.length === 0) {
        if (noDataEl) noDataEl.style.display = 'flex';
        if (plotsEl) plotsEl.innerHTML = '';
        return;
    }

    if (noDataEl) noDataEl.style.display = 'none';
    renderTimelinePlots();
}

// Render line plots for each selected index
function renderTimelinePlots() {
    const plotsContainer = document.getElementById('timelinePlots');
    if (!plotsContainer) return;

    plotsContainer.innerHTML = '';

    const selectedIndexes = Array.from(timelineTabState.selectedIndexes);
    const selectedCountries = Array.from(timelineTabState.selectedCountries);

    // Build color map for countries
    const countryColorMap = {};
    selectedCountries.forEach((code, i) => {
        countryColorMap[code] = countryColors[i % countryColors.length];
    });

    selectedIndexes.forEach(indexId => {
        const indexInfo = state.indexes.find(i => i.id === indexId);
        const label = getIndexLabel(indexInfo) || indexId;

        // Group data by country and filter valid values
        const countryDataMap = {};
        let hasAnyData = false;

        selectedCountries.forEach(countryCode => {
            const countryData = timelineTabState.data
                .filter(d => d.country_code === countryCode && d[indexId] !== null && d[indexId] !== undefined)
                .map(d => ({ year: d.year, value: d[indexId], country_code: countryCode }));

            if (countryData.length > 0) {
                countryDataMap[countryCode] = countryData;
                hasAnyData = true;
            }
        });

        if (!hasAnyData) return;

        // Create plot container
        const plotDiv = document.createElement('div');
        plotDiv.className = 'timeline-line-plot';

        // Build legend HTML if multiple countries
        let legendHtml = '';
        if (selectedCountries.length > 1) {
            const legendItems = selectedCountries
                .filter(code => countryDataMap[code])
                .map(code => {
                    const country = timelineTabState.allCountries.find(c => c.code === code);
                    const name = country ? country.name : code;
                    const color = countryColorMap[code];
                    return `<div class="timeline-legend-item"><span class="timeline-legend-color" style="background-color: ${color}"></span><span>${name}</span></div>`;
                })
                .join('');
            legendHtml = `<div class="timeline-line-plot-legend">${legendItems}</div>`;
        }

        plotDiv.innerHTML = `
            <div class="timeline-line-plot-header">
                <h3 class="timeline-line-plot-title hoverable">${label}</h3>
            </div>
            <div class="timeline-line-plot-chart" id="chart-${indexId}"></div>
            ${legendHtml}
        `;
        plotsContainer.appendChild(plotDiv);

        // Attach tooltip events to the title
        const titleEl = plotDiv.querySelector('.timeline-line-plot-title');
        if (titleEl && indexInfo) {
            titleEl.addEventListener('mouseenter', (e) => showAxisLabelTooltip(e, indexInfo));
            titleEl.addEventListener('mousemove', (e) => showAxisLabelTooltip(e, indexInfo));
            titleEl.addEventListener('mouseleave', hideAxisLabelTooltip);
        }

        // Render the line chart with multiple countries
        renderLineChart(`chart-${indexId}`, countryDataMap, indexInfo, countryColorMap);
    });
}

// Render a line chart using D3 with multiple countries support
function renderLineChart(containerId, countryDataMap, indexInfo, countryColorMap) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const countryCodes = Object.keys(countryDataMap);
    if (countryCodes.length === 0) return;

    // Extract indexId from containerId (format: "chart-{indexId}")
    const indexId = containerId.replace('chart-', '');

    // Get container dimensions
    const rect = container.getBoundingClientRect();
    const width = rect.width || 400;
    const height = rect.height || 200;

    // Margins
    const margin = { top: 20, right: 20, bottom: 35, left: 55 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Clear previous content
    container.innerHTML = '';

    // Create SVG
    const svg = d3.select(`#${containerId}`)
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    // Add clip path for zooming
    svg.append('defs')
        .append('clipPath')
        .attr('id', `clip-${indexId}`)
        .append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', innerWidth)
        .attr('height', innerHeight);

    const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Collect all data points for scale calculation
    const allData = [];
    countryCodes.forEach(code => {
        allData.push(...countryDataMap[code]);
    });

    // Scales
    const xExtent = d3.extent(allData, d => d.year);
    const yExtent = d3.extent(allData, d => d.value);

    // Add some padding to y extent
    const yPadding = (yExtent[1] - yExtent[0]) * 0.1 || 1;
    const yMin = yExtent[0] - yPadding;
    const yMax = yExtent[1] + yPadding;

    const xScale = d3.scaleLinear()
        .domain(xExtent)
        .range([0, innerWidth]);

    const yScale = d3.scaleLinear()
        .domain([yMin, yMax])
        .range([innerHeight, 0]);

    // Store original domains for reset zoom
    const originalXDomain = xScale.domain();
    const originalYDomain = yScale.domain();

    // Apply saved zoom state if exists
    const savedZoom = timelineTabState.zoomState[indexId];
    if (savedZoom) {
        xScale.domain(savedZoom.xDomain);
        yScale.domain(savedZoom.yDomain);
    }

    // Get theme colors
    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? '#475569' : '#e5e7eb';
    const textColor = isDark ? '#cbd5e1' : '#475569';

    // Grid lines group (for updating on zoom)
    const xGridGroup = g.append('g')
        .attr('class', 'grid x-grid')
        .attr('transform', `translate(0,${innerHeight})`);

    const yGridGroup = g.append('g')
        .attr('class', 'grid y-grid');

    // X axis group
    const xAxisGroup = g.append('g')
        .attr('class', 'x-axis')
        .attr('transform', `translate(0,${innerHeight})`);

    // Y axis group
    const yAxisGroup = g.append('g')
        .attr('class', 'y-axis');

    // Function to update axes and grid
    function updateAxesAndGrid() {
        // Update X grid
        xGridGroup.call(d3.axisBottom(xScale)
            .ticks(Math.min(5, allData.length))
            .tickSize(-innerHeight)
            .tickFormat(''));
        xGridGroup.selectAll('line')
            .style('stroke', gridColor)
            .style('stroke-opacity', 0.3);
        xGridGroup.select('.domain').style('stroke', gridColor);

        // Update Y grid
        yGridGroup.call(d3.axisLeft(yScale)
            .ticks(5)
            .tickSize(-innerWidth)
            .tickFormat(''));
        yGridGroup.selectAll('line')
            .style('stroke', gridColor)
            .style('stroke-opacity', 0.3);
        yGridGroup.select('.domain').style('stroke', gridColor);

        // Update X axis
        xAxisGroup.call(d3.axisBottom(xScale)
            .ticks(Math.min(5, allData.length))
            .tickFormat(d3.format('d')));
        xAxisGroup.selectAll('text')
            .style('fill', textColor)
            .style('font-size', '11px');
        xAxisGroup.select('.domain').style('stroke', gridColor);
        xAxisGroup.selectAll('.tick line').style('stroke', gridColor);

        // Update Y axis
        yAxisGroup.call(d3.axisLeft(yScale)
            .ticks(5)
            .tickFormat(d => formatValue(d, indexInfo)));
        yAxisGroup.selectAll('text')
            .style('fill', textColor)
            .style('font-size', '11px');
        yAxisGroup.select('.domain').style('stroke', gridColor);
        yAxisGroup.selectAll('.tick line').style('stroke', gridColor);
    }

    // Initial render of axes and grid
    updateAxesAndGrid();

    // Zoom functionality with brush
    // Track if we're in pan mode (zoomed in)
    const isZoomed = () => !!timelineTabState.zoomState[indexId];

    const brush = d3.brush()
        .extent([[0, 0], [innerWidth, innerHeight]])
        .filter(event => !event.button && !isZoomed()) // Only when NOT zoomed
        .on('end', brushEnded);

    const brushGroup = g.append('g')
        .attr('class', 'brush')
        .call(brush);

    // Pan state variables
    let panStartX, panStartY, panStartXDomain, panStartYDomain;

    // Drag handler for panning when zoomed
    const drag = d3.drag()
        .filter(event => !event.button && isZoomed()) // Only when ZOOMED
        .on('start', function(event) {
            panStartX = event.x;
            panStartY = event.y;
            panStartXDomain = xScale.domain().slice();
            panStartYDomain = yScale.domain().slice();
            d3.select(this).style('cursor', 'grabbing');
        })
        .on('drag', function(event) {
            const dx = event.x - panStartX;
            const dy = event.y - panStartY;

            // Convert pixel movement to domain units
            const xDomainWidth = panStartXDomain[1] - panStartXDomain[0];
            const yDomainHeight = panStartYDomain[1] - panStartYDomain[0];

            const xShift = -dx * xDomainWidth / innerWidth;
            const yShift = dy * yDomainHeight / innerHeight;

            xScale.domain([panStartXDomain[0] + xShift, panStartXDomain[1] + xShift]);
            yScale.domain([panStartYDomain[0] + yShift, panStartYDomain[1] + yShift]);

            // Save zoom state
            timelineTabState.zoomState[indexId] = {
                xDomain: xScale.domain(),
                yDomain: yScale.domain()
            };

            // Update display for smooth dragging
            updateAxesAndGrid();

            // Update lines without transition
            lines.forEach(({ path, data }) => {
                path.attr('d', line(data));
            });

            // Update dots without transition
            dotGroups.forEach(dots => {
                dots.attr('cx', d => xScale(d.year))
                    .attr('cy', d => yScale(d.value));
            });
        })
        .on('end', function() {
            d3.select(this).style('cursor', 'grab');
        });

    // Apply drag to brush overlay
    brushGroup.select('.overlay').call(drag);

    // Function to update cursor based on zoom state
    function updateCursor() {
        const cursor = isZoomed() ? 'grab' : 'crosshair';
        brushGroup.select('.overlay').style('cursor', cursor);
    }

    // Initial cursor
    updateCursor();

    // Create a group for chart elements with clip path
    const chartGroup = g.append('g')
        .attr('clip-path', `url(#clip-${indexId})`);

    // Line generator
    const line = d3.line()
        .x(d => xScale(d.year))
        .y(d => yScale(d.value))
        .curve(d3.curveMonotoneX);

    // Draw line and dots for each country
    const lines = [];
    const dotGroups = [];

    countryCodes.forEach(countryCode => {
        const data = countryDataMap[countryCode];
        const color = countryColorMap[countryCode] || '#2563eb';

        // Draw line
        const linePath = chartGroup.append('path')
            .datum(data)
            .attr('class', 'line')
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', 2)
            .attr('d', line);
        lines.push({ path: linePath, data: data });

        // Draw dots
        const dots = chartGroup.selectAll(`.dot-${countryCode}`)
            .data(data)
            .enter()
            .append('circle')
            .attr('class', `dot dot-${countryCode}`)
            .attr('cx', d => xScale(d.year))
            .attr('cy', d => yScale(d.value))
            .attr('r', 3)
            .attr('fill', color)
            .style('cursor', 'pointer')
            .on('mouseenter', function(event, d) {
                d3.select(this).attr('r', 5);
                showTimelineTooltip(event, d, indexInfo, countryCode, color);
            })
            .on('mouseleave', function() {
                d3.select(this).attr('r', 3);
                hideTimelineTooltip();
            });
        dotGroups.push(dots);
    });

    function brushEnded(event) {
        if (!event.selection) return; // Ignore empty selections

        const [[x0, y0], [x1, y1]] = event.selection;

        // Update scale domains based on selection
        xScale.domain([xScale.invert(x0), xScale.invert(x1)]);
        yScale.domain([yScale.invert(y1), yScale.invert(y0)]); // y is inverted

        // Save zoom state for persistence
        timelineTabState.zoomState[indexId] = {
            xDomain: xScale.domain(),
            yDomain: yScale.domain()
        };

        // Clear the brush
        brushGroup.call(brush.move, null);

        // Update axes and grid
        updateAxesAndGrid();

        // Update lines
        lines.forEach(({ path, data }) => {
            path.transition()
                .duration(750)
                .attr('d', line(data));
        });

        // Update dots
        dotGroups.forEach(dots => {
            dots.transition()
                .duration(750)
                .attr('cx', d => xScale(d.year))
                .attr('cy', d => yScale(d.value));
        });

        // Show reset button
        resetButton.style('display', 'block');

        // Update cursor to grab mode
        updateCursor();
    }

    // Reset zoom function
    function resetZoom() {
        // Reset to original domains
        xScale.domain(originalXDomain);
        yScale.domain(originalYDomain);

        // Clear saved zoom state
        delete timelineTabState.zoomState[indexId];

        // Update axes and grid
        updateAxesAndGrid();

        // Update lines
        lines.forEach(({ path, data }) => {
            path.transition()
                .duration(750)
                .attr('d', line(data));
        });

        // Update dots
        dotGroups.forEach(dots => {
            dots.transition()
                .duration(750)
                .attr('cx', d => xScale(d.year))
                .attr('cy', d => yScale(d.value));
        });

        // Hide reset button
        resetButton.style('display', 'none');

        // Update cursor back to crosshair mode
        updateCursor();
    }

    // Add reset zoom button to the plot container (parent of chart container)
    const plotContainer = container.closest('.timeline-line-plot');
    const hasZoom = !!savedZoom;
    const resetButton = d3.select(plotContainer)
        .append('button')
        .attr('class', 'reset-zoom-btn')
        .style('display', hasZoom ? 'block' : 'none')
        .text(t('reset-zoom'))
        .on('click', resetZoom);

    // Add double-click to reset zoom on the plot area
    svg.on('dblclick', function() {
        if (timelineTabState.zoomState[indexId]) {
            resetZoom();
        }
    });
}

// Format value based on index info
function formatValue(value, indexInfo) {
    if (value === null || value === undefined) return '—';

    const decimals = indexInfo?.decimals ?? 2;
    const format = indexInfo?.format || 'number';

    if (format === 'percent') {
        return (value * 100).toFixed(decimals) + '%';
    }

    // Format with appropriate precision
    if (Math.abs(value) >= 1e9) {
        return (value / 1e9).toFixed(1) + 'B';
    } else if (Math.abs(value) >= 1e6) {
        return (value / 1e6).toFixed(1) + 'M';
    } else if (Math.abs(value) >= 1e3) {
        return (value / 1e3).toFixed(1) + 'K';
    } else {
        return value.toFixed(decimals);
    }
}

// Show tooltip for timeline line plot
function showTimelineTooltip(event, d, indexInfo, countryCode, lineColor) {
    let tooltip = document.querySelector('.timeline-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip timeline-tooltip';
        document.body.appendChild(tooltip);
    }

    const color = lineColor || '#2563eb';
    const label = getIndexLabel(indexInfo) || indexInfo?.id || 'Value';
    const formattedValue = formatValue(d.value, indexInfo);
    const countryName = getCountryLabel(countryCode);

    tooltip.innerHTML = `
        <div class="timeline-tooltip-header">
            <span class="timeline-tooltip-dot" style="background-color: ${color};"></span>
            <span class="timeline-tooltip-name">${countryName}</span>
            <span class="timeline-tooltip-year">(${d.year})</span>
        </div>
        <div>${label}: ${formattedValue}</div>
    `;

    tooltip.style.opacity = '1';

    // Position tooltip relative to viewport so it stays near the cursor even when scrolled
    const offset = 10;
    let x = event.clientX + offset;
    let y = event.clientY - offset;

    // Keep tooltip within viewport bounds
    const tooltipRect = tooltip.getBoundingClientRect();
    const maxX = window.innerWidth - tooltipRect.width - offset;
    const maxY = window.innerHeight - tooltipRect.height - offset;

    x = Math.max(offset, Math.min(x, maxX));
    y = Math.max(offset, Math.min(y, maxY));

    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
}

// Hide tooltip
function hideTimelineTooltip() {
    const tooltip = document.querySelector('.timeline-tooltip');
    if (tooltip) {
        tooltip.style.opacity = '0';
    }
}
