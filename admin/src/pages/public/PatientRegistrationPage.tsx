import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { PublicLayout } from '../../components/PublicLayout';
import { useToast } from '../../context/ToastContext';
import { ApiError, createPatient } from '../../lib/publicApi';
import type { Patient } from '../../lib/types';

interface FormState {
  name: string;
  email: string;
  phone: string;
}

const EMPTY_FORM: FormState = { name: '', email: '', phone: '' };

export const PatientRegistrationPage = (): JSX.Element => {
  const { showToast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdPatient, setCreatedPatient] = useState<Patient | null>(null);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const patient = await createPatient(form);
      setCreatedPatient(patient);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'No se pudo completar el registro, intentá de nuevo';
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (createdPatient) {
    return (
      <PublicLayout title="¡Listo!" subtitle="Tu registro se creó correctamente.">
        <p className="text-sm text-black-900">
          Hola <strong>{createdPatient.name}</strong>, ya podés reservar tu primera cita.
        </p>
        <Link
          to={`/reservar?patientId=${createdPatient.id}`}
          className="mt-6 block rounded-btn bg-blue-500 px-4 py-3 text-center text-sm font-medium text-white hover:bg-blue-700"
        >
          Reservar una cita
        </Link>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout
      title="Registro de paciente"
      subtitle="Completá tus datos para crear tu registro en la clínica."
    >
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <div>
          <label htmlFor="name" className="block text-xs font-medium text-black-600">
            Nombre completo
          </label>
          <input
            id="name"
            type="text"
            required
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
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
            value={form.email}
            onChange={(event) => updateField('email', event.target.value)}
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
            value={form.phone}
            onChange={(event) => updateField('phone', event.target.value)}
            className="mt-1 w-full rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 rounded-btn bg-blue-500 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Creando…' : 'Crear mi registro'}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-black-600">
        ¿Ya tenés un registro?{' '}
        <Link to="/reservar" className="text-blue-500 hover:text-blue-700">
          Ir directo a reservar
        </Link>
      </p>
    </PublicLayout>
  );
};
