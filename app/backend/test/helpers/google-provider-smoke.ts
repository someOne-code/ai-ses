export function buildUniqueGoogleSmokeSlot(seed: string) {
  const day = 10 + (Number.parseInt(seed.slice(0, 2), 16) % 10);
  const hour = 5 + (Number.parseInt(seed.slice(2, 4), 16) % 3);
  const minute = Number.parseInt(seed.slice(4, 6), 16) % 60;
  const utcHour = hour - 3;
  const datePart = `2030-01-${String(day).padStart(2, "0")}`;
  const timePart = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  const utcTimePart = `${String(utcHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

  return {
    preferredDatetime: `${datePart}T${timePart}+03:00`,
    preferredDatetimeUtc: `${datePart}T${utcTimePart}`
  };
}
