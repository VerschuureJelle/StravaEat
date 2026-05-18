export const ACTIVITY_LEVELS = [
  {
    key: 'sedentary',
    label: 'Sedentary',
    detail: 'Desk job, little movement',
    factor: 1.2,
    info: 'You have a desk job or study and don\'t exercise regularly. You walk to the car, around the office, but your body is largely still for most of the day.',
  },
  {
    key: 'light',
    label: 'Light',
    detail: '1–3 workouts/week',
    factor: 1.375,
    info: 'You exercise 1–3 times per week at a casual pace — a few walks, a gym session, a weekend ride. Outside of those sessions your daily life is mostly sedentary.',
  },
  {
    key: 'moderate',
    label: 'Moderate',
    detail: '3–5 workouts/week',
    factor: 1.55,
    info: 'You train consistently 3–5 days per week at a real intensity. Your workouts are planned and regular. This fits most recreational athletes who exercise but have a desk job otherwise.',
  },
  {
    key: 'active',
    label: 'Active',
    detail: '6–7 hard sessions/week',
    factor: 1.725,
    info: 'You train hard 6–7 days per week, or combine regular intense training with a job that keeps you on your feet. Think a competitive club runner or cyclist doing daily rides.',
  },
  {
    key: 'very_active',
    label: 'Very active',
    detail: 'Athlete + physical job',
    factor: 1.9,
    info: 'You combine high-volume, high-intensity daily training with a physically demanding job — construction worker who trains, professional athlete in a build phase, or military personnel.',
  },
] as const

export type ActivityLevelKey = typeof ACTIVITY_LEVELS[number]['key']
