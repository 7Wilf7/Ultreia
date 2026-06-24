// Per-type plan field visibility — which inputs the add/edit-plan form shows for
// a given activity type (time-of-day is always shown). Shared by Calendar editing
// and AI Coach action review so a plan reads the same wherever it is edited.
//   Road Run        → run type + distance
//   Trail / Hiking  → distance + ascent
//   Floor Climbing  → ascent
//   Cycling         → distance + speed
//   Swimming        → duration
//   Strength        → body area(s)
//   HIIT            → time-of-day only
export function planFields(type) {
  return {
    runType:  type === "Road Run",
    distance: type === "Road Run" || type === "Trail Run" || type === "Hiking" || type === "Cycling",
    ascent:   type === "Trail Run" || type === "Hiking" || type === "Floor Climbing",
    speed:    type === "Cycling",
    duration: type === "Swimming",
    strength: type === "Strength",
  };
}
