export interface AvailabilityBlockInput {
  startTime: string;
  endTime: string;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface Slot {
  startTime: string;
  endTime: string;
  available: boolean;
}

export const SLOT_MINUTES = 30;

export const parseTimeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

const minutesToTime = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (totalMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

// Las fechas de los slots se construyen con el constructor de componentes
// (year, month, day, hours, minutes) para operar siempre en hora local y
// evitar el corrimiento de día que produce `new Date('YYYY-MM-DD')` (que
// parsea como medianoche UTC) al combinarlo con setHours().
export const generateSlotsForDate = (
  year: number,
  month: number,
  day: number,
  availabilityBlocks: AvailabilityBlockInput[],
  busyIntervals: BusyInterval[],
): Slot[] => {
  const slots: Slot[] = [];

  for (const block of availabilityBlocks) {
    const blockStartMinutes = parseTimeToMinutes(block.startTime);
    const blockEndMinutes = parseTimeToMinutes(block.endTime);

    for (
      let slotStartMinutes = blockStartMinutes;
      slotStartMinutes + SLOT_MINUTES <= blockEndMinutes;
      slotStartMinutes += SLOT_MINUTES
    ) {
      const slotEndMinutes = slotStartMinutes + SLOT_MINUTES;
      const slotStart = new Date(year, month - 1, day, 0, slotStartMinutes, 0, 0);
      const slotEnd = new Date(year, month - 1, day, 0, slotEndMinutes, 0, 0);

      const available = !busyIntervals.some((busy) => slotStart < busy.end && busy.start < slotEnd);

      slots.push({
        startTime: minutesToTime(slotStartMinutes),
        endTime: minutesToTime(slotEndMinutes),
        available,
      });
    }
  }

  return slots;
};
