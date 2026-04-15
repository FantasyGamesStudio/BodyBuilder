# Decisiones funcionales consolidadas — v1

Documento de trabajo tras iteración con producto. Incluye respuestas acordadas y **supuestos explícitos** donde se delegó criterio técnico/analítico. Para diseño técnico e implementación.

---

## 1. Identidad, cuentas y mercado

| Tema | Decisión |
|------|----------|
| Tipos de cuenta | Email/contraseña + OAuth Google y Apple. |
| Multi-dispositivo | Un usuario, varios dispositivos; recuperación de cuenta soportada. |
| Idioma | ES. |
| Fechas/hora | `dd-mm-aaaa`, `hh:mm`. |
| Unidades | Peso: **kg**. Comida y macros: **g** o **ml** según contexto; energía: **kcal**. |
| Edad / cumplimiento | No prioritario en v1 privada de prueba; ver `deferred_backlog.md`. |

---

## 2. Onboarding y cálculo de objetivos

### 2.1 Método de gasto energético y TDEE (propuesta cerrada para implementación)

- **TMB**: fórmula **Mifflin–St Jeor** (estándar en apps de fitness; buen equilibrio simpleza/precisión).
  - Hombre: `10 × peso(kg) + 6,25 × altura(cm) − 5 × edad + 5`
  - Mujer: `10 × peso(kg) + 6,25 × altura(cm) − 5 × edad − 161`
- **Factor de actividad** (multiplicador sobre TMB): refleja **trabajo + vida diaria + pasos/NEAT**, no el detalle día a día del gimnasio.
  - Sedentario 1,20 · Ligero 1,375 · Moderado 1,55 · Activo 1,725 · Muy activo 1,9
  - *Guía UX*: texto claro en onboarding (“trabajo de oficina y poco paseo” vs “en pie todo el día”, etc.).
- **TDEE base** = TMB × factor actividad.
- **Días de entreno vs descanso** (objetivos distintos): el documento pide calorías distintas según tipo de día. Enfoque recomendado:
  - Calcular un **promedio semanal** de gasto si se conoce duración/intensidad aproximada del entreno, **o**
  - Mantener **TDEE único** y aplicar **delta fijo** en días de entreno (ej. +150–300 kcal en carbos), configurable o sugerido por la app según frecuencia.  
  - *Regla de oro*: no sumar “muy activo” en actividad **y** además un gran bonus diario sin criterio, para no doble contar.

El usuario **puede ajustar en cualquier momento** calorías y macros manuales; el sistema debe guardar si el objetivo es “calculado” vs “manual” para informes.

### 2.2 Definición operativa de modos de objetivo (para reglas y copy)

Valores orientativos sobre **TDEE calculado**; ajustables por usuario y por evolución del peso.

| Modo | Idea | Superávit / déficit típico (sobre TDEE) | Ritmo de peso orientativo* |
|------|------|----------------------------------------|----------------------------|
| **Volumen limpio** | Ganancia muscular con mínima grasa | **+5 % a +15 %** kcal (típico **+250–400 kcal/d** en muchos usuarios) | **+0,25 % a +0,5 %** del peso corporal / semana |
| **Mantenimiento** | Estabilidad | **Cerca del TDEE** (rango ±3–5 % por adherencia) | Peso estable (oscilaciones normales agua/sales) |
| **Definición** | Pérdida de grasa preservando músculo | **−15 % a −25 %** (típico **−300–500 kcal/d** según tolerancia) | **−0,5 % a −1 %** del peso / semana (más lento si ya delgado) |
| **Recomposición** | Menos grasa / mejor composición sin peso “de dieta” agresiva | **−5 % a +5 %** o ligero déficit (**−10 %** máx. suele usarse) + **proteína alta** + entreno progresivo | Peso estable o lento; éxito medido también por medidas/fotos/fuerza |
| **Pérdida de peso** | Reducir peso en báscula con enfoque en tendencia semanal; puede solaparse con definición si entrena | **−15 % a −30 %** sobre TDEE según agresividad elegida | **−0,5 % a −1 %** del peso / semana; copy prudente si el déficit es agresivo |

\* Ritmos no son promesas médicas; la app debe mostrarlos como **orientación** y enlazar con confirmación del usuario en ajustes automáticos sugeridos.

**Definición vs pérdida de peso (producto):** **Definición** prioriza composición, medidas y fotos; **pérdida de peso** prioriza la tendencia de la báscula y la adherencia al déficit (ambas comparten lógica de déficit; diferencian énfasis en informes, copy y presets por defecto).

**Proteína (punto de partida para cálculo inicial):** rango habitual **1,6–2,2 g/kg/d** en volumen/definición/recomp/pérdida de peso; en mantenimiento **1,4–1,8 g/kg/d** según preferencia. Grasas mínimas **~0,6–0,8 g/kg/d** (o ~25–30 % kcal); el resto hidratos.

### 2.3 Reparto del superávit en volumen (y días de entreno)

- Tras fijar **proteína** y un **mínimo de grasa** saludable, las **calorías restantes y el incremento del superávit** se asignan preferentemente a **hidratos**: encajan con mejor rendimiento en fuerza, glucógeno y adherencia en fases de ganancia (enfoque habitual en nutrición deportiva; no excluye grasas adicionales si el usuario las prefiere dentro del total).
- **Día de entreno:** el delta calórico extra respecto al día de descanso se aplica **en la misma lógica**: priorizar **hidratos** una vez cubiertos P y grasa mínima; el importe del delta sigue siendo configurable (p. ej. +150–300 kcal).

### 2.4 NEAT, EAT y modelos de comportamiento por objetivo

**Definiciones:**

- **NEAT** (termogénesis sin ejercicio “estructurado”): movimiento cotidiano. En la app, proxy típico: **pasos** (integración futura con teléfono) y/o registro manual breve (“día más/menos movido”).
- **EAT** (actividad deportiva intencional): entrenamientos; ya cubierto por **calendario de entreno** + opción futura de **kcal de sesión** estimadas.

**Principio:** el **objetivo calórico de ingesta** es el eje principal; NEAT/EAT sirven para **contextualizar** y **evitar errores sistemáticos** (p. ej. volumen con NEAT muy alto que “come” el superávit).

| Objetivo | Comportamiento de la app (v1 diseño) |
|----------|--------------------------------------|
| **Volumen limpio** | Objetivo ingesta = TDEE + superávit. Si el usuario registra NEAT **sustancialmente por encima** de su línea base, la app puede **sugerir** un ajuste **opcional** de +kcal (prioridad hidratos) para no quedar en déficit involuntario; requiere **confirmación** del usuario. NEAT muy bajo: aviso suave, sin cambiar objetivo automáticamente. |
| **Definición / Pérdida de peso** | Objetivo ingesta = TDEE − déficit. **Objetivo de NEAT mínimo** (p. ej. pasos diarios) como **pilar aparte**: cumplirlo **no suma** calorías al techo del día por defecto (evita “comer de vuelta” el movimiento). Incumplir NEAT mínimo: feedback de adherencia (“movilidad”), **sin** alterar solo el déficit para compensar. **EAT:** por defecto **no** se “come de vuelta” todo el gasto estimado del gimnasio salvo toggle explícito futuro. |
| **Mantenimiento** | Banda explícita alrededor del TDEE (ver §2.5). NEAT solo como contexto informativo en v1. |
| **Recomposición** | Similar a déficit leve + alta proteína; NEAT mínimo recomendable como en déficit. |

### 2.4 bis Onboarding: objetivo NEAT mínimo (pasos) — sugerencia + edición

- El usuario **introduce o confirma** un valor (p. ej. pasos diarios mínimos) durante el onboarding o en ajustes.
- La app muestra **siempre una sugerencia** derivada del **objetivo principal** y, en su caso, del **nivel de actividad** declarado, para no dejar el campo “en blanco” sin contexto.

**Valores orientativos iniciales (editables, copy prudente):**

| Objetivo principal | Sugerencia por defecto (pasos/día) | Nota UX |
|--------------------|-------------------------------------|---------|
| **Pérdida de peso / Definición / Recomposición** (énfasis déficit) | **7 000** | Refuerza hábito de movilidad sin sustituir al déficit; si actividad declarada “activa”, proponer **8 000–9 000**. |
| **Volumen limpio** | **6 000** | Prioridad entreno + ingesta; suelo bajo para no añadir fricción; si usuario muy sedentario en trabajo, sugerir **7 000** por salud metabólica/movilidad. |
| **Mantenimiento** | **7 000** o **8 000** si actividad ≥ moderada | Equilibrio “moverse sin obsesión”. |

La sugerencia es **no vinculante**: el usuario puede aceptarla con un toque o ajustar el número. Tras unas semanas de datos reales, la app puede proponer **revisar** el mínimo en función de la mediana (ya definida en §13.2).

### 2.5 Horquillas explícitas en la UI (“zona verde”)

El usuario ve **objetivo central** y **banda de adherencia** (ajustables con aviso de que son guías, no certezas):

| Métrica | Banda por defecto (respecto al objetivo del día) |
|---------|--------------------------------------------------|
| **Calorías** | **±7 %** del objetivo kcal (mantenimiento: **±5 %**). Mostrar mínimo y máximo de la horquilla en la misma pantalla que el anillo/barra. |
| **Proteína** | Cumple si ingesta **≥ 95 %** del objetivo en gramos. |
| **Grasas** | Si hay **techo máximo** (objetivo “máx. grasas”), cumple si ingesta **≤ 100 %** del techo; si hay **mínimo**, cumple si **≥ 90 %** del mínimo. |
| **Hidratos** | Completar el resto; en volumen/día entreno mostrar mínimo sugerido si aplica. |

*Estos valores son punto de partida; pueden exponerse “avanzado” para power users.*

### 2.6 “Nivel de actividad” vs “días de entreno”

- **Nivel de actividad**: cuán movida es tu **jornada habitual** (oficina, pie, físico…). Entra en el **multiplicador** del TDEE.
- **Días de entreno**: cuántos días haces **entrenamiento de fuerza** (calendario). Sirve para: toggle del día, **reparto calórico** entreno/descanso, adherencia y mensajes tipo “hoy toca entreno”.

No son lo mismo: puedes ser “sedentario” en el trabajo pero entrenar 4 días (actividad baja + sesiones acotadas); el factor de actividad no debe decir “muy activo” solo por el gym si el resto del día es sofá.

### 2.7 Restricciones dietéticas

- Obviadas en v1; ver backlog.

### 2.8 Privacidad al estilo Instagram (cuenta y contenido)

**Decisión de producto:** alineación con el modelo mental de **Instagram**, adaptado a esta app.

- **Cuenta privada:** quien no sigue al usuario solo ve **nick (handle)** y **foto de perfil** (y eventualmente bio vacía/mínima). El feed, publicaciones, rachas, logros visibles y demás datos sociales **solo** para seguidores **aceptados** (si el flujo incluye solicitudes) o seguidores mutuos según implementación del MVP.
- **Cuenta pública:** el perfil y las publicaciones configuradas como públicas son visibles para cualquier usuario de la plataforma (sujeto a bloqueos futuros en backlog).
- **Por publicación:** se mantiene lo acordado: visibilidad **pública** o **solo seguidores** por post.
- **Datos de salud / tracking:** peso, medidas, fotos de progreso corporal, historial de comidas **no** se exponen al perfil salvo que en el futuro exista un opt-in explícito por campo (no en MVP social descrito).
- **“Mixto”:** se interpreta como **cuenta pública** con **controles por tipo de contenido** en evolución; no hace falta un tercer modo rígido si Instagram-like cubre la expectativa.

---

## 3. Registro de comidas y modelo de datos

| Tema | Decisión |
|------|----------|
| Momento del día | Cualquier hora; **slots por defecto**: desayuno, almuerzo, merienda, cena; el usuario puede añadir más etiquetas/slots. |
| Zona horaria y “día nutricional” | El **día de la app** es el **día civil local del usuario** (medianoche → medianoche en su zona horaria del perfil/dispositivo). *Opción futura*: desplazar cierre del día (ej. 04:00) para quien cena muy tarde — no requerido en v1. |
| Frecuentes / plantillas | Uso personal; atajos a comidas ya marcadas como frecuentes; **sin compartir** entre usuarios en v1. |
| Catálogo de alimentos | No hay catálogo inicial obligatorio; **construir catálogo interno** a partir de datos que los usuarios vayan confirmando (nombre, macros, etc.) para enriquecer contexto al LLM. |
| Foto + audio (MVP) | Entrada al **slot de comida** (ej. desayuno): una o **varias fotos** + **audio**; el LLM devuelve macros/kcal y **feedback** del día; el usuario puede **rectificar** y dar **explicación** (texto/audio) para ajuste; trazabilidad fuente = IA + correcciones. |

**Implicación técnica**: pipeline multimodal (visión + audio → texto o modelo multimodal) y política de almacenamiento de medios (privacidad, retención).

---

## 4. IA / LLM (producto)

| Tema | Decisión |
|------|----------|
| Proveedor | **OpenRouter**; modelo concreto = decisión técnica (coste/calidad multimodal). Fallback = otro modelo vía OpenRouter o degradación a solo texto. |
| Límites | Sin tope en uso privado inicial; documentar coste. |
| Retención prompts/respuestas | **Qué significa**: guardar (o no) el texto/audio enviado y la respuesta del modelo para depuración, soporte, mejora de prompts y coherencia del “día”. **Propuesta v1**: almacenar en backend asociado al usuario y a la comida/interacción, con política de borrado al borrar cuenta; no usar para entrenar terceros sin consentimiento explícito futuro. |
| “Aprender del usuario” | En v1: **persistencia estructurada** (peso, medidas, macros, objetivos, historial) en BBDD para informes y contexto en prompts; no implica fine-tuning del modelo salvo decisión explícita posterior. |
| **Coach / agente “en la sombra”** | Experiencia unificada: el mismo flujo por el que el usuario envía **fotos y audio** de comidas es el **interlocutor principal** para estimaciones, rectificaciones y **consejos bajo demanda**. Debe mantener **continuidad conversacional** unos días (**ventana deslizante ~7 días** desde la última interacción, configurable): hilo con historial reciente + **resumen compacto** para contexto en el LLM. |
| **Retención del coach (7 días)** | Tras **7 días sin actividad** en el hilo del agente, el sistema **elimina** el hilo y sus mensajes, y **borra del almacenamiento de objetos** los binarios **referenciados solo por ese contexto de coach** (p. ej. adjuntos de chat no vinculados a una `meal_entry` ya confirmada). Se purgan o anonimizan registros **`ai_interaction`** asociados **únicamente** a ese hilo. **No** se borran medios ni datos de comidas **confirmadas** ni el historial nutricional consolidado. |
| Límites de salud | Asistente: **seguimiento del día**, sugerencias para **cerrar el día**, resúmenes diarios/semanales; **no** diagnóstico ni sustitución de profesional; tono prudente. |

---

## 5. Objetivos dinámicos y reglas de negocio

| Tema | Decisión |
|------|----------|
| Ajuste por peso | **Semanal** y/o **umbral de kg/semana**; **siempre con confirmación** del usuario antes de aplicar cambios a objetivos. |
| Adherencia | Ver **objetivos del día** (lista cerrada v1) y horquillas en §2.5. |
| Entreno | **Calendario** de días de entreno + **toggle en la vista de hoy** para excepciones. |

### 5.1 Objetivos del día (adherencia y posts)

Además del rango calórico y proteína, el sistema reconoce como objetivos diarios (para dashboard, XP y “objetivos cumplidos” en posts):

| Código | Descripción |
|--------|-------------|
| `app_open` | Abrir la app al menos una vez en el día (engagement sano). |
| `calories_in_green` | Calorías dentro de la **horquilla** del §2.3 bis. |
| `protein_target_met` | Proteína ≥ 95 % del objetivo. |
| `fat_max_respected` | Si existe techo de grasas, ingesta ≤ techo. |
| `fat_min_met` | Si existe mínimo de grasas, ingesta ≥ 90 % del mínimo. |
| `measures_due_done` | Si tocaba registro de **medidas corporales** ese día/semana según recordatorio, está completado. |
| `weight_logged` | Peso registrado (si está activado como hábito diario). |
| `neat_floor_met` | Objetivo mínimo de NEAT cumplido (p. ej. pasos), cuando esté activo para déficit. |
| `all_meals_logged` | Opcional: usuario marcó todas las comidas planificadas / slots cubiertos. |

La lista exacta en API puede usar estos códigos; el copy en español es responsabilidad de UI.

---

## 6. Seguimiento corporal

| Tema | Decisión |
|------|----------|
| Medidas (cm) | Conjunto habitual: **peso (kg)**, **cintura**, **cadera**, **pecho**, **cuadriceps/muslo**, **brazo** (flexionado opcional), **cuello** opcional. Frecuencia sugerida en UX: **semanal** (misma hora, mismo día) para suavizar ruido; quincenal aceptable si mucha fricción. |
| Peso | **Diario**; para tendencia usar **media semanal** y/o **suavizado** descartando outliers (ej. desviación fuerte respecto a **mediana** de la semana o reglas tipo IQR). |
| Fotos | **Frente y perfil** (lado); **privadas**, no en feed. |
| Hitos | **Tipos predefinidos** + **texto libre**. |

---

## 7. Evaluaciones periódicas

| Tema | Decisión |
|------|----------|
| Periodicidad | **Semanal** por defecto; también **mensual**; comportamiento por defecto definido en app. |
| Informe | Gráficos + **énfasis variable** según objetivo del usuario (lógica + sugerencias del LLM sobre qué destacar). |
| Histórico | **Indefinido** en BBDD; **sin exportación** en v1. |

---

## 8. Social (MVP acordado)

| Tema | Decisión |
|------|----------|
| Tipos de post | **Texto** + **foto** + **resumen del día** con **objetivos cumplidos** marcados. |
| Visibilidad por post | **Público** y **solo seguidores** (seguidores = relación **aceptada** si la cuenta es privada). |
| **Cuenta privada** | Otro usuario debe **enviar solicitud de seguimiento** y el titular **aceptar** antes de que el solicitante pueda ver su **feed**, posts no públicos y demás contenido reservado a seguidores (modelo tipo Instagram). |
| **Cuenta pública** | Perfil y posts con visibilidad pública son visibles sin seguir; esos posts **alimentan el feed público / timeline** de la plataforma para todos los usuarios (además del feed “solo gente que sigo”). |
| Moderación / descubrimiento avanzado | Búsqueda, hashtags, recomendaciones → `deferred_backlog.md`; el **feed público cronológico** (o simple) **sí** forma parte del MVP social descrito. |
| Notificaciones | Likes, comentarios, **solicitud de seguimiento**, seguimiento aceptado; **in-app siempre**. **Push:** primero **Web Push** (cliente web); más adelante **FCM/APNs** en nativo. El backend expone **una sola interfaz** de envío; la implementación concreta depende del canal suscrito por el dispositivo (ver `technical_design_v0.md`). |

---

## 9. Gamificación — propuesta inicial (ajustable con UX)

### 9.1 XP por acción (valores iniciales)

| Acción | XP sugerida | Notas |
|--------|-------------|--------|
| Registrar comida (confirmada) | 15 | Una vez por comida registrada al día |
| Completar objetivo calórico del día (rango acordado) | 40 | |
| Cumplir objetivo de proteína | 25 | |
| Registrar peso | 15 | |
| Registrar medidas corporales | 25 | Menos frecuente |
| Subir fotos de progreso (par frente/perfil) | 30 | Semanal máx. 1× bonus si se desea cap |
| Mantener racha N días | 10 × N cada hito | Ej. bonificación en 3, 7, 14, 30 días |
| Publicar en feed (post válido) | 20 | Anti-spam: límite diario técnico, abuso en backlog |
| Abrir/completar evaluación semanal | 50 | |

*Afinar tras pruebas; se puede normalizar “XP diaria máxima suave” sin bloquear uso legítimo.*

### 9.2 Niveles (lineal)

- **Fórmula ejemplo**: `XP_total_necesaria_para_nivel_N = 1000 × N` (nivel 1 a los 1000 XP acumulados, nivel 2 a los 2000 adicionales, etc.) o más simple: **1000 XP por nivel** acumulativo global: nivel = `floor(XP_acumulada / 1000) + 1`.  
- Elegir una variante en implementación y documentar en API.

### 9.3 Moneda “Determinación” (icono de llama en la UI)

- Se gana con acciones, cumplir objetivos, subir de nivel; **no caduca**.
- Tienda inicial: **color del nombre**, **marcos de avatar**, **trofeos visibles en perfil**.

---

## 10. No funcionales y operación (v1)

| Tema | Decisión |
|------|----------|
| Analítica (propuesta) | Eventos mínimos: registro instalación, registro/login, onboarding completado, comida registrada (modo), objetivo del día cumplido, peso registrado, post publicado, sesión diaria (DAU proxy). Herramienta: la que elija el stack (ej. PostHog, Amplitude, o logs agregados propios en fase muy temprana). |
| RGPD / accesibilidad / soporte | Aplazado → `deferred_backlog.md`. |
| Offline | **Cola de envío** de datos cuando vuelva conexión. |

### 10.1 Estrategia de clientes (largo plazo)

- **Backend común** para todas las superficies.
- **Fase inicial:** cliente **web** para validar flujos, diseño y UX con menor fricción de despliegue.
- **Fase posterior:** apps **Android e iOS** nativas o multiplataforma, con **integración con el teléfono** (pasos, salud) apoyándose en el mismo backend.

---

## 11. Alcance de releases

- **Intención**: incluir en el camino todo lo **no** marcado como aplazado en este documento y en `deferred_backlog.md`.
- **Riesgo de alcance**: foto+audio+LLM multimodal + social + gamificación + evaluaciones + objetivos dinámicos en un solo tranche es pesado; el agente técnico debería proponer **orden de entrega** (hitos internos) sin recortar visión.
- **Prueba privada inicial:** sin pagos, sin límites agresivos anti-spam en seguimiento; suscripción y pase de batalla **no** entran en ese MVP (ver §12).

---

## 12. Visión futura: suscripción de pago y “pase de batalla”

*Fuera del MVP de prueba privada; sirve para diseñar **extension points** en backend y producto.*

### 12.1 Usuario suscrito (pago recurrente, p. ej. mensual)

- Los usuarios con suscripción activa (**“miembros”**) desbloquean **funciones premium** que se irán listando; ejemplo ya comentado: **seguimiento / informe semanal ampliado** (más profundo que el resumen gratuito o con frecuencia distinta).
- El catálogo exacto de perks es **TBD**; el sistema debe permitir **feature flags por `subscription_tier`** sin reescribir el núcleo.

### 12.2 Pase de batalla (misiones temporales)

- Temporadas o campañas con **fecha inicio/fin**.
- **Misiones** concretas (ej. “registra 7 días seguidos de proteína”, “publica 3 resúmenes de día”) verificables por reglas en servidor.
- Al completar: recompensa en **Determinación** y/o **ítems cosméticos** exclusivos de esa temporada.
- **Miembros de pago:** **premios extra** en la misma misión (bonificación de moneda, pista adicional, cosmético adicional) y/o **recompensas reservadas solo para suscriptores** en determinadas filas del pase.

### 12.3 Implicaciones

- Pasarela de pago (Stripe u otra), impuestos, facturación y **Apple/Google IAP** si hay nativo: documentar en fase de monetización; ver `deferred_backlog.md`.

---

## 13. Glosario y decisiones operativas

### 13.1 ¿Qué es **eat-back**?

Es la idea de **“devolver”** al presupuesto calórico del día parte de las calorías que quemaste en el **entreno (EAT)**.  
*Ejemplo:* objetivo 2000 kcal; el usuario estima 400 kcal en el gimnasio; con eat-back al 50 % podría comer hasta **2200 kcal** ese día.

**Disponibilidad según objetivo principal (regla de producto):**

| Objetivo principal | Eat-back |
|--------------------|----------|
| **Volumen limpio** | **Permitido.** Por defecto **desactivado**; el usuario puede activarlo en ajustes cuando exista la función (post-MVP o fase avanzada). Opcionalmente la app puede **sugerir** activarlo si el entreno es muy largo/intenso (heurística futura). |
| **Mantenimiento** | **Permitido**, por defecto **desactivado**. |
| **Definición / Pérdida de peso / Recomposición** en lógica de déficit | **No disponible** (control desactivado u oculto): evita erosionar el déficit de forma involuntaria. |

En el **MVP de prueba privada** puede no implementarse el toggle; la tabla fija la intención de diseño.

### 13.2 ¿Qué es la **línea base NEAT** (baseline)?

Es la referencia de **movimiento habitual** del usuario (p. ej. **mediana de pasos de los últimos 14 días** desde que activó el seguimiento de pasos). Sirve para decir “hoy te moviste mucho más que lo normal” y, en **volumen**, valorar si conviene **sugerir** un pequeño extra de kcal (siempre con confirmación).  
**Decisión por defecto para implementación:** baseline = **mediana de pasos en ventana móvil de 14 días** (sin días sin dato si se prefiere).

### 13.3 Medios de comida (no coach) — política adoptada

- **Al borrar** una comida confirmada o borrador: encolar **borrado asíncrono** de sus objetos en almacenamiento.
- **Job periódico** (p. ej. cada 24 h): eliminar binarios **huérfanos** (subida iniciada pero **sin** `meal_entry` vinculada o estado abandonado) con antigüedad **> 48 h**.

### 13.4 Feed público

- **Cronológico** en el MVP (como acordaste).

### 13.5 Límites de solicitudes de seguimiento / anti-spam

- **Fuera del MVP** de prueba privada; se retoma al abrir registro público masivo.

---

*Documento generado para alinear implementación; revisar tras primera batería de pruebas con usuarios.*
