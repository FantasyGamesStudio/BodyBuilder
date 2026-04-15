# Mock de monetización (MVP / prueba privada)

Objetivo: dar **sensación de producto completo** sin pasarela de pago. Todo es **local / flag**, sin cobros reales.

## Enfoque

1. **Variable de entorno** (API y/o web): `MOCK_SUBSCRIPTION=true` o `VITE_MOCK_PREMIUM=true`.
2. **API:** si el mock está activo, `GET /v1/me` incluye:
   - `subscription: { tier: "member" | "free", status: "active", is_mock: true }`
   - Cuando `tier=member` mock, el backend puede devolver los mismos payloads que un miembro real **solo** para rutas ya construidas (ej. informe semanal ampliado) o **404** con mensaje “próximamente” según lo que esté implementado.
3. **Web:** badge **“Miembro”** (o icono), sección “Ventajas premium” con lista **no bloqueante**; partes “bloqueadas” muestran overlay con “Disponible con suscripción (simulado)”.

## Reglas

- Nunca mostrar precio real ni enlazar a Stripe en mock.
- En producción futura: `is_mock` debe ser **imposible** o siempre `false` cuando exista billing.

## QA rápido

- Conmutar `tier` entre `free` y `member` en respuesta mock y comprobar que la UI reacciona (badges, CTAs).
