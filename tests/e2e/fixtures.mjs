export const NWS_HOURLY_URL = 'https://api.weather.gov/gridpoints/HNX/53,50/forecast/hourly';

export function pointResponse(hourlyUrl = NWS_HOURLY_URL) {
  return { properties: { forecastHourly: hourlyUrl } };
}

export function hourlyResponse({
  nowMs = Date.now(),
  issuedAt = new Date(nowMs - 60_000).toISOString(),
  temperature = 70,
  windSpeed = '5 mph',
  windDirection = 'NW',
  humidity = 55
} = {}) {
  const hour = 60 * 60 * 1000;
  const start = Math.floor(nowMs / hour) * hour;
  return {
    properties: {
      updateTime: issuedAt,
      periods: Array.from({ length: 24 }, (_, index) => ({
        startTime: new Date(start + index * hour).toISOString(),
        endTime: new Date(start + (index + 1) * hour).toISOString(),
        number: index + 1,
        isDaytime: true,
        temperature,
        temperatureUnit: 'F',
        windSpeed,
        windDirection,
        relativeHumidity: { value: humidity },
        shortForecast: 'Sunny'
      }))
    }
  };
}
