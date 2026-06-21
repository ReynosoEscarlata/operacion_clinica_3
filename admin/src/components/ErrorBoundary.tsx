import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Sin esto, cualquier excepción durante el render (ej. un shape de
// respuesta inesperado del backend) deja la pantalla completamente en
// blanco sin ninguna pista de qué pasó — React desmonta el árbol entero.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Error no capturado en el panel admin', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-ice p-4">
        <div className="w-full max-w-lg rounded-modal bg-white p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-danger">Ocurrió un error inesperado</h1>
          <p className="mt-2 text-sm text-black-600">
            La consola del navegador tiene el detalle técnico. Mensaje:
          </p>
          <pre className="mt-3 overflow-auto rounded-btn bg-ice p-3 text-xs text-black-900">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-6 rounded-btn bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}
