/**
 * Fábrica de la app Fastify para los tests de integración.
 *
 * Construye una instancia completamente inicializada (plugins + rutas)
 * sin arrancar ningún servidor TCP — los tests usan `app.inject()`.
 */

import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

let _app: FastifyInstance | null = null;

/** Devuelve (o crea) la instancia de la app lista para inyectar peticiones. */
export async function getTestApp(): Promise<FastifyInstance> {
  if (!_app) {
    _app = await buildApp();
    // Espera a que todos los plugins estén registrados
    await _app.ready();
  }
  return _app;
}

/** Cierra la app y libera recursos. Llamar en afterAll. */
export async function closeTestApp() {
  if (_app) {
    await _app.close();
    _app = null;
  }
}
