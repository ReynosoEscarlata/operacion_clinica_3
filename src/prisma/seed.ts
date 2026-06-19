import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DOCTORS = [
  { name: 'Dra. Lucía Fernández', email: 'lucia.fernandez@clinica.example.com', specialty: 'Cardiología' },
  { name: 'Dr. Martín Gómez', email: 'martin.gomez@clinica.example.com', specialty: 'Dermatología' },
  { name: 'Dra. Valentina Ríos', email: 'valentina.rios@clinica.example.com', specialty: 'Pediatría' },
];

const PATIENTS = [
  { email: 'ana.torres@example.com', name: 'Ana Torres', phone: '+54 9 11 5555-0001' },
  { email: 'bruno.diaz@example.com', name: 'Bruno Díaz', phone: '+54 9 11 5555-0002' },
  { email: 'carla.suarez@example.com', name: 'Carla Suárez', phone: '+54 9 11 5555-0003' },
  { email: 'diego.morales@example.com', name: 'Diego Morales', phone: '+54 9 11 5555-0004' },
  { email: 'elena.castro@example.com', name: 'Elena Castro', phone: '+54 9 11 5555-0005' },
];

// Disponibilidad de ejemplo: lunes a viernes, 09:00–13:00 y 14:00–17:00
const WEEKDAY_SLOTS = [
  { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' },
  { dayOfWeek: 1, startTime: '14:00', endTime: '17:00' },
  { dayOfWeek: 2, startTime: '09:00', endTime: '13:00' },
  { dayOfWeek: 3, startTime: '09:00', endTime: '13:00' },
  { dayOfWeek: 4, startTime: '09:00', endTime: '13:00' },
  { dayOfWeek: 5, startTime: '09:00', endTime: '13:00' },
];

const main = async (): Promise<void> => {
  for (const patient of PATIENTS) {
    await prisma.patient.upsert({
      where: { email: patient.email },
      update: {},
      create: patient,
    });
  }

  for (const doctorData of DOCTORS) {
    const existingDoctor = await prisma.doctor.findFirst({ where: { email: doctorData.email } });
    const doctor = existingDoctor ?? (await prisma.doctor.create({ data: doctorData }));

    await prisma.availability.deleteMany({ where: { doctorId: doctor.id } });
    await prisma.availability.createMany({
      data: WEEKDAY_SLOTS.map((slot) => ({ ...slot, doctorId: doctor.id })),
    });
  }
};

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Error al ejecutar el seed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
