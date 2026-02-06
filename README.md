<p align="center">
  <img src="src/public/favicons/logo.png" alt="Data of the World" width="1150">
</p>


# Data of the World

Interactive dashboard for exploring and comparing global statistics across countries and years. Visualize relationships between economic, social, and governance indicators through scatterplots, timelines, maps, and data tables.

**Live demo:** [https://dataofthe.world](https://dataofthe.world)

## Data Sources

All data is aggregated from authoritative international sources.

Read more on http://dataofthe.world/indicators

### World Bank
Fetched via REST API (`api.worldbank.org`):
- GDP
- Annual GDP Growth
- GDP per Capita
- GDP per Capita PPP 
- Debt to GDP Ratio
- Population
- Inflation Rate
- Unemployment Rate
- Life Expectancy
- Fertility Rate
- Urbanization Rate
- Gini Coefficient
- Control of Corruption
- Homicide Rate

### Our World in Data
Downloaded as CSV files (`ourworldindata.org`):
- Human Development Index
- The Economist Democracy Index
- Self-Reported Life Satisfaction
- Median Age
- Gender Inequality Index

### Reporters Without Borders
Downloaded as CSV files `rsf.org`:
- Press Freedom Index

## Collecting Data

Data collection scripts are in `data_collection/`. You need Python with Jupyter and pandas.

1. **Run the notebooks** (in any order):
   ```
   data_collection/world_bank.ipynb
   data_collection/our_world_in_data.ipynb
   data_collection/reporters_without_borders.ipynb
   ```
   These fetch data and save JSON files to `data_collection/data/`.

2. **Build the database**:
   ```bash
   python data_collection/create_database.py
   ```
   This creates `dataoftheworld.db` SQLite database from the collected JSON files.

## Self-Hosting on Docker Compose

```bash
docker-compose up --build
```
App runs on port `8004`.

## Tech Stack

- **Backend:** Node.js, Express, SQLite3
- **Frontend:** HTML/CSS/JS, D3.js
- **Data collection:** Python, Jupyter, pandas
