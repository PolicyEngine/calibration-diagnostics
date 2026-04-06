/**
 * Census benchmark data for comparison against calibrated dataset.
 *
 * SPM/OPM rates: Census Bureau P60-287, 3-year average 2022-2024.
 * Source: https://www2.census.gov/programs-surveys/demo/tables/p60/287/spm_opm_state.xlsx
 *
 * Population/household counts: 2020 Decennial Census.
 *
 * Median AGI: FRED (Federal Reserve Economic Data), sourced from Census Bureau SAIPE, 2023.
 * Source: https://fred.stlouisfed.org/series/MEDAGI{STATE}{FIPS}A052NCEN
 *
 * These are static — updated annually when Census/IRS publishes new data.
 */

export const SOURCE_URLS = {
  spm_opm: "https://www2.census.gov/programs-surveys/demo/tables/p60/287/spm_opm_state.xlsx",
  median_agi_prefix: "https://fred.stlouisfed.org/series/MEDAGI",
  census_2020: "https://data.census.gov/table/DECENNIALDHC2020.P1",
};

export interface CensusBenchmark {
  spm_rate: number; // SPM poverty rate (%)
  opm_rate: number; // Official poverty rate (%)
  population_2020?: number; // 2020 Census population
  households_2020?: number; // 2020 Census household count
  median_agi?: number; // Median AGI from FRED/Census SAIPE (2023)
  median_agi_fred_series?: string; // FRED series ID for source link
}

export const CENSUS_BENCHMARKS: Record<string, CensusBenchmark> = {
  "United States": { spm_rate: 12.7, opm_rate: 11.1, population_2020: 331449281, households_2020: 131202752 },
  "Alabama": { spm_rate: 13.5, opm_rate: 14.7, population_2020: 5024279, households_2020: 1907725, median_agi: 47500, median_agi_fred_series: "MEDAGIAL1A052NCEN" },
  "Alaska": { spm_rate: 10.4, opm_rate: 9.7, population_2020: 733391, households_2020: 258058, median_agi: 63500, median_agi_fred_series: "MEDAGIAK2A052NCEN" },
  "Arizona": { spm_rate: 12.9, opm_rate: 11.6, population_2020: 7151502, households_2020: 2664842, median_agi: 52500, median_agi_fred_series: "MEDAGIAZ4A052NCEN" },
  "Arkansas": { spm_rate: 13.6, opm_rate: 14.5, population_2020: 3011524, households_2020: 1160237, median_agi: 45000, median_agi_fred_series: "MEDAGIAR5A052NCEN" },
  "California": { spm_rate: 17.7, opm_rate: 11.2, population_2020: 39538223, households_2020: 13044266, median_agi: 58500, median_agi_fred_series: "MEDAGICA6A052NCEN" },
  "Colorado": { spm_rate: 10.3, opm_rate: 8.1, population_2020: 5773714, households_2020: 2174981, median_agi: 61500, median_agi_fred_series: "MEDAGICO8A052NCEN" },
  "Connecticut": { spm_rate: 9.9, opm_rate: 9.2, population_2020: 3605944, households_2020: 1388561, median_agi: 64000, median_agi_fred_series: "MEDAGICT9A052NCEN" },
  "Delaware": { spm_rate: 9.3, opm_rate: 8.5, population_2020: 989948, households_2020: 384204, median_agi: 57000, median_agi_fred_series: "MEDAGIDE10A052NCEN" },
  "District of Columbia": { spm_rate: 15.3, opm_rate: 12.4, population_2020: 689545, households_2020: 303235, median_agi: 72000, median_agi_fred_series: "MEDAGIDC11A052NCEN" },
  "Florida": { spm_rate: 16.0, opm_rate: 12.1, population_2020: 21538187, households_2020: 8175220, median_agi: 46500, median_agi_fred_series: "MEDAGIFL12A052NCEN" },
  "Georgia": { spm_rate: 13.5, opm_rate: 12.4, population_2020: 10711908, households_2020: 3830972, median_agi: 47500, median_agi_fred_series: "MEDAGIGA13A052NCEN" },
  "Hawaii": { spm_rate: 10.8, opm_rate: 8.6, population_2020: 1455271, households_2020: 464449, median_agi: 57000, median_agi_fred_series: "MEDAGIHI15A052NCEN" },
  "Idaho": { spm_rate: 8.4, opm_rate: 8.5, population_2020: 1839106, households_2020: 669208, median_agi: 55000, median_agi_fred_series: "MEDAGIID16A052NCEN" },
  "Illinois": { spm_rate: 11.1, opm_rate: 10.3, population_2020: 12812508, households_2020: 4916485, median_agi: 58500, median_agi_fred_series: "MEDAGIIL17A052NCEN" },
  "Indiana": { spm_rate: 9.3, opm_rate: 9.1, population_2020: 6785528, households_2020: 2577961, median_agi: 52000, median_agi_fred_series: "MEDAGIIN18A052NCEN" },
  "Iowa": { spm_rate: 7.7, opm_rate: 8.4, population_2020: 3190369, households_2020: 1273439, median_agi: 58500, median_agi_fred_series: "MEDAGIIA19A052NCEN" },
  "Kansas": { spm_rate: 9.1, opm_rate: 8.9, population_2020: 2937880, households_2020: 1117270, median_agi: 55000, median_agi_fred_series: "MEDAGIKS20A052NCEN" },
  "Kentucky": { spm_rate: 14.3, opm_rate: 15.5, population_2020: 4505836, households_2020: 1776068, median_agi: 48500, median_agi_fred_series: "MEDAGIKY21A052NCEN" },
  "Louisiana": { spm_rate: 17.7, opm_rate: 19.4, population_2020: 4657757, households_2020: 1768853, median_agi: 43000, median_agi_fred_series: "MEDAGILA22A052NCEN" },
  "Maine": { spm_rate: 6.7, opm_rate: 8.1, population_2020: 1362359, households_2020: 577022, median_agi: 53500, median_agi_fred_series: "MEDAGIME23A052NCEN" },
  "Maryland": { spm_rate: 11.2, opm_rate: 8.3, population_2020: 6177224, households_2020: 2230527, median_agi: 63500, median_agi_fred_series: "MEDAGIMD24A052NCEN" },
  "Massachusetts": { spm_rate: 11.7, opm_rate: 9.2, population_2020: 7029917, households_2020: 2672569, median_agi: 68500, median_agi_fred_series: "MEDAGIMA25A052NCEN" },
  "Michigan": { spm_rate: 10.5, opm_rate: 11.9, population_2020: 10077331, households_2020: 3940423, median_agi: 51000, median_agi_fred_series: "MEDAGIMI26A052NCEN" },
  "Minnesota": { spm_rate: 7.5, opm_rate: 7.2, population_2020: 5706494, households_2020: 2200836, median_agi: 63000, median_agi_fred_series: "MEDAGIMN27A052NCEN" },
  "Mississippi": { spm_rate: 16.4, opm_rate: 17.4, population_2020: 2961279, households_2020: 1105750, median_agi: 40500, median_agi_fred_series: "MEDAGIMS28A052NCEN" },
  "Missouri": { spm_rate: 10.0, opm_rate: 10.2, population_2020: 6154913, households_2020: 2440952, median_agi: 52000, median_agi_fred_series: "MEDAGIMO29A052NCEN" },
  "Montana": { spm_rate: 9.4, opm_rate: 8.7, population_2020: 1084225, households_2020: 437935, median_agi: 53500, median_agi_fred_series: "MEDAGIMT30A052NCEN" },
  "Nebraska": { spm_rate: 8.2, opm_rate: 8.0, population_2020: 1961504, households_2020: 766663, median_agi: 57000, median_agi_fred_series: "MEDAGINE31A052NCEN" },
  "Nevada": { spm_rate: 14.7, opm_rate: 12.6, population_2020: 3104614, households_2020: 1117612, median_agi: 51000, median_agi_fred_series: "MEDAGINV32A052NCEN" },
  "New Hampshire": { spm_rate: 8.6, opm_rate: 6.8, population_2020: 1377529, households_2020: 546342, median_agi: 68500, median_agi_fred_series: "MEDAGINH33A052NCEN" },
  "New Jersey": { spm_rate: 12.4, opm_rate: 9.1, population_2020: 9288994, households_2020: 3340229, median_agi: 64500, median_agi_fred_series: "MEDAGINJ34A052NCEN" },
  "New Mexico": { spm_rate: 12.4, opm_rate: 17.2, population_2020: 2117522, households_2020: 804349, median_agi: 44000, median_agi_fred_series: "MEDAGINM35A052NCEN" },
  "New York": { spm_rate: 14.4, opm_rate: 11.6, population_2020: 20201249, households_2020: 7448012, median_agi: 56000, median_agi_fred_series: "MEDAGINY36A052NCEN" },
  "North Carolina": { spm_rate: 14.0, opm_rate: 14.0, population_2020: 10439388, households_2020: 4012012, median_agi: 51000, median_agi_fred_series: "MEDAGINC37A052NCEN" },
  "North Dakota": { spm_rate: 8.2, opm_rate: 9.3, population_2020: 779094, households_2020: 319649, median_agi: 62500, median_agi_fred_series: "MEDAGIND38A052NCEN" },
  "Ohio": { spm_rate: 9.3, opm_rate: 10.5, population_2020: 11799448, households_2020: 4698784, median_agi: 53000, median_agi_fred_series: "MEDAGIOH39A052NCEN" },
  "Oklahoma": { spm_rate: 11.6, opm_rate: 13.7, population_2020: 3959353, households_2020: 1502668, median_agi: 47500, median_agi_fred_series: "MEDAGIOK40A052NCEN" },
  "Oregon": { spm_rate: 11.1, opm_rate: 9.6, population_2020: 4237256, households_2020: 1644429, median_agi: 57500, median_agi_fred_series: "MEDAGIOR41A052NCEN" },
  "Pennsylvania": { spm_rate: 10.6, opm_rate: 10.2, population_2020: 13002700, households_2020: 5170956, median_agi: 56500, median_agi_fred_series: "MEDAGIPA42A052NCEN" },
  "Rhode Island": { spm_rate: 9.1, opm_rate: 9.3, population_2020: 1097379, households_2020: 432365, median_agi: 57000, median_agi_fred_series: "MEDAGIRI44A052NCEN" },
  "South Carolina": { spm_rate: 11.7, opm_rate: 11.9, population_2020: 5118425, households_2020: 1991107, median_agi: 49000, median_agi_fred_series: "MEDAGISC45A052NCEN" },
  "South Dakota": { spm_rate: 7.9, opm_rate: 8.6, population_2020: 886667, households_2020: 346706, median_agi: 57500, median_agi_fred_series: "MEDAGISD46A052NCEN" },
  "Tennessee": { spm_rate: 10.1, opm_rate: 10.1, population_2020: 6910840, households_2020: 2688988, median_agi: 50500, median_agi_fred_series: "MEDAGITN47A052NCEN" },
  "Texas": { spm_rate: 14.3, opm_rate: 12.3, population_2020: 29145505, households_2020: 9872411, median_agi: 50000, median_agi_fred_series: "MEDAGITX48A052NCEN" },
  "Utah": { spm_rate: 8.4, opm_rate: 6.6, population_2020: 3271616, households_2020: 1024755, median_agi: 60000, median_agi_fred_series: "MEDAGIUT49A052NCEN" },
  "Vermont": { spm_rate: 9.5, opm_rate: 7.6, population_2020: 643077, households_2020: 270052, median_agi: 56000, median_agi_fred_series: "MEDAGIVT50A052NCEN" },
  "Virginia": { spm_rate: 10.5, opm_rate: 8.6, population_2020: 8631393, households_2020: 3198816, median_agi: 62000, median_agi_fred_series: "MEDAGIVA51A052NCEN" },
  "Washington": { spm_rate: 10.8, opm_rate: 9.2, population_2020: 7614893, households_2020: 2898673, median_agi: 69000, median_agi_fred_series: "MEDAGIWA53A052NCEN" },
  "West Virginia": { spm_rate: 12.5, opm_rate: 13.9, population_2020: 1793716, households_2020: 729503, median_agi: 47000, median_agi_fred_series: "MEDAGIWV54A052NCEN" },
  "Wisconsin": { spm_rate: 7.7, opm_rate: 8.3, population_2020: 5893718, households_2020: 2383742, median_agi: 58000, median_agi_fred_series: "MEDAGIWI55A052NCEN" },
  "Wyoming": { spm_rate: 8.3, opm_rate: 8.1, population_2020: 576851, households_2020: 224044, median_agi: 59500, median_agi_fred_series: "MEDAGIWY56A052NCEN" },
};

/**
 * Look up benchmark by state name or "National"/"United States".
 */
export function getBenchmark(geoLabel: string): CensusBenchmark | null {
  if (geoLabel === "National" || geoLabel === "US") {
    return CENSUS_BENCHMARKS["United States"];
  }
  return CENSUS_BENCHMARKS[geoLabel] ?? null;
}
