export function defaultTemplates() {
  return [
    {
      id: 'walk_basic',
      name: 'Прогулка (базовый)',
      minWindowMinutes: 60,
      defaultConfigJson: {
        modules: [
          { type: 'wind_max_ms', max: 8 },
          { type: 'gust_max_ms', max: 12 },
          { type: 'precip_max_mmh', max: 1.5 },
          { type: 'temp_range_c', min: -15, max: 30 },
          { type: 'no_thunderstorm' },
        ],
      },
    },
  ];
}
