export interface AvailabilityBlockInput {
  startTime: string;
  endTime: string;
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

// A diferencia del monolito, esta versión NO recibe busyIntervals: Doctors
// no tiene acceso a la tabla de Appointments (cero estado compartido,
// RFC-001) — "disponible" aquí significa únicamente "dentro del horario
// configurado", no "no reservado todavía". El conflicto de reserva lo
// detecta Appointments con su propia transacción Serializable.
export const generateSlotsForDate = (availabilityBlocks: AvailabilityBlockInput[]): Slot[] => {
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

      slots.push({
        startTime: minutesToTime(slotStartMinutes),
        endTime: minutesToTime(slotEndMinutes),
        available: true,
      });
    }
  }

  return slots;
};

// Combina year/month/day (componentes locales, evita el corrimiento de
// día de `new Date('YYYY-MM-DD')`) con un "HH:MM" de Slot para producir el
// ISO datetime que Appointments compara contra `dateTime.toISOString()`
// (ver packages/contracts/doctors/openapi.yaml: GET /doctors/:id/slots).
export const slotToIsoDateTime = (year: number, month: number, day: number, startTime: string): string => {
  const minutes = parseTimeToMinutes(startTime);
  const date = new Date(year, month - 1, day, 0, minutes, 0, 0);
  return date.toISOString();
};
