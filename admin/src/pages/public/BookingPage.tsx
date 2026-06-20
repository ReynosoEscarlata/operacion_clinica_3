import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';

import { PublicLayout } from '../../components/PublicLayout';
import { useToast } from '../../context/ToastContext';
import { formatCents, formatDateTime } from '../../lib/format';
import { getStripe } from '../../lib/stripe';
import {
  ApiError,
  createAppointment,
  createPatient,
  findPatientByEmail,
  getDoctorSlots,
  getPatientById,
  listDoctorsPublic,
} from '../../lib/publicApi';
import type { Doctor, Patient, Slot } from '../../lib/types';
import { CheckoutForm } from './CheckoutForm';

type BookingStep = 'identify' | 'schedule' | 'payment' | 'success';

const todayDateString = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// El horario elegido se construye con el constructor de componentes de Date
// (no parseando un string) para operar en la misma hora local que usa el
// backend al validar disponibilidad — ver nota equivalente en slots.ts.
const buildDateTimeIso = (dateStr: string, time: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
};

export const BookingPage = (): JSX.Element => {
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();

  const [step, setStep] = useState<BookingStep>('identify');
  const [isLoadingPatient, setIsLoadingPatient] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [identifyForm, setIdentifyForm] = useState({ name: '', email: '', phone: '' });

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [selectedDate, setSelectedDate] = useState(todayDateString());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isCreatingAppointment, setIsCreatingAppointment] = useState(false);

  const selectedDoctor = doctors.find((doctor) => doctor.id === selectedDoctorId) ?? null;

  // Si llega con ?patientId= (ej. desde /registro), se salta el paso de identificación.
  useEffect(() => {
    const patientId = searchParams.get('patientId');
    if (!patientId) return;

    setIsLoadingPatient(true);
    getPatientById(patientId)
      .then((found) => {
        setPatient(found);
        setStep('schedule');
      })
      .catch(() => showToast('No se encontró el paciente, completá tus datos de nuevo', 'error'))
      .finally(() => setIsLoadingPatient(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listDoctorsPublic()
      .then(setDoctors)
      .catch(() => showToast('No se pudo cargar la lista de doctores', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step !== 'schedule' || !selectedDoctorId || !selectedDate) {
      setSlots([]);
      return;
    }

    setIsLoadingSlots(true);
    setSelectedSlot(null);

    getDoctorSlots(selectedDoctorId, selectedDate)
      .then(setSlots)
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : 'No se pudieron cargar los horarios';
        showToast(message, 'error');
        setSlots([]);
      })
      .finally(() => setIsLoadingSlots(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedDoctorId, selectedDate]);

  const handleIdentifySubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setIsLoadingPatient(true);

    try {
      let found: Patient;
      try {
        found = await findPatientByEmail(identifyForm.email);
        showToast(`Bienvenido de nuevo, ${found.name}`, 'success');
      } catch (lookupError) {
        if (lookupError instanceof ApiError && lookupError.status === 404) {
          found = await createPatient(identifyForm);
        } else {
          throw lookupError;
        }
      }

      setPatient(found);
      setStep('schedule');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo continuar, intentá de nuevo';
      showToast(message, 'error');
    } finally {
      setIsLoadingPatient(false);
    }
  };

  const handleSelectSlot = async (slot: Slot): Promise<void> => {
    if (!patient || !selectedDoctorId) return;

    setSelectedSlot(slot);
    setIsCreatingAppointment(true);

    try {
      const result = await createAppointment({
        patientId: patient.id,
        doctorId: selectedDoctorId,
        dateTime: buildDateTimeIso(selectedDate, slot.startTime),
      });
      setClientSecret(result.clientSecret);
      setStep('payment');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo reservar el horario';
      showToast(message, 'error');
      setSelectedSlot(null);
    } finally {
      setIsCreatingAppointment(false);
    }
  };

  if (step === 'success') {
    return (
      <PublicLayout title="¡Cita confirmada!" subtitle="Te enviaremos un email con los detalles.">
        <div className="rounded-card border border-black-300 bg-ice p-4 text-sm text-black-900">
          <p>
            <strong>Doctor:</strong> {selectedDoctor?.name}
          </p>
          <p>
            <strong>Fecha:</strong> {selectedSlot && formatDateTime(buildDateTimeIso(selectedDate, selectedSlot.startTime))}
          </p>
        </div>
      </PublicLayout>
    );
  }

  if (step === 'payment' && clientSecret) {
    return (
      <PublicLayout title="Pagar y confirmar" subtitle="El pago se procesa de forma segura con Stripe.">
        <div className="mb-4 rounded-card border border-black-300 bg-ice p-4 text-sm text-black-900">
          <p>
            <strong>Doctor:</strong> {selectedDoctor?.name} ({selectedDoctor?.specialty})
          </p>
          <p>
            <strong>Horario:</strong> {selectedSlot?.startTime} – {selectedSlot?.endTime}
          </p>
          <p>
            <strong>Monto:</strong> {selectedDoctor && formatCents(selectedDoctor.consultationPriceCents)}
          </p>
        </div>

        <Elements stripe={getStripe()} options={{ clientSecret }}>
          <CheckoutForm onSuccess={() => setStep('success')} />
        </Elements>
      </PublicLayout>
    );
  }

  if (step === 'schedule') {
    return (
      <PublicLayout
        title="Elegí doctor y horario"
        subtitle={patient ? `Hola ${patient.name}, ¿cuándo querés tu consulta?` : undefined}
      >
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="doctor" className="block text-xs font-medium text-black-600">
              Doctor
            </label>
            <select
              id="doctor"
              value={selectedDoctorId}
              onChange={(event) => setSelectedDoctorId(event.target.value)}
              className="mt-1 w-full rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900"
            >
              <option value="">Seleccioná un doctor</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name} — {doctor.specialty} ({formatCents(doctor.consultationPriceCents)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="date" className="block text-xs font-medium text-black-600">
              Fecha
            </label>
            <input
              id="date"
              type="date"
              min={todayDateString()}
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="mt-1 w-full rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900"
            />
          </div>

          {selectedDoctorId && (
            <div>
              <p className="mb-2 text-xs font-medium text-black-600">Horarios disponibles</p>
              {isLoadingSlots ? (
                <div className="h-20 animate-pulse rounded-card bg-ice" />
              ) : slots.length === 0 ? (
                <p className="text-sm text-black-600">No hay horarios disponibles este día.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((slot) => (
                    <button
                      key={slot.startTime}
                      type="button"
                      disabled={!slot.available || isCreatingAppointment}
                      onClick={() => void handleSelectSlot(slot)}
                      className={`rounded-btn border px-2 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                        selectedSlot?.startTime === slot.startTime
                          ? 'border-blue-500 bg-blue-100 text-blue-700'
                          : 'border-black-300 text-black-900 hover:bg-ice'
                      }`}
                    >
                      {slot.startTime}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout
      title="Reservar una cita"
      subtitle="Decinos tus datos para empezar (si ya tenés un registro, los reconocemos por tu email)."
    >
      <form onSubmit={(event) => void handleIdentifySubmit(event)} className="flex flex-col gap-4">
        <div>
          <label htmlFor="name" className="block text-xs font-medium text-black-600">
            Nombre completo
          </label>
          <input
            id="name"
            type="text"
            required
            value={identifyForm.name}
            onChange={(event) => setIdentifyForm((current) => ({ ...current, name: event.target.value }))}
            className="mt-1 w-full rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-xs font-medium text-black-600">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={identifyForm.email}
            onChange={(event) => setIdentifyForm((current) => ({ ...current, email: event.target.value }))}
            className="mt-1 w-full rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block text-xs font-medium text-black-600">
            Teléfono
          </label>
          <input
            id="phone"
            type="tel"
            required
            placeholder="+54 9 11 5555-0000"
            value={identifyForm.phone}
            onChange={(event) => setIdentifyForm((current) => ({ ...current, phone: event.target.value }))}
            className="mt-1 w-full rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={isLoadingPatient}
          className="mt-2 rounded-btn bg-blue-500 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoadingPatient ? 'Verificando…' : 'Continuar'}
        </button>
      </form>
    </PublicLayout>
  );
};
