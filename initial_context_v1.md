# Contexto base para LLM — App de seguimiento nutricional, progreso físico y volumen limpio

## Qué es esta app

Esta app está pensada para personas que quieren llevar un seguimiento muy práctico, continuo y motivador de su nutrición, composición corporal y progreso físico, con un foco especial en **ganancia muscular / volumen limpio**, aunque debe poder evolucionar para soportar también mantenimiento, definición y recomposición corporal.

La idea nace de un flujo real que hoy se hace manualmente cada día en un chat con un asistente: registrar comidas, estimar calorías y macros, comprobar si el día está alineado con el objetivo, registrar peso, revisar tendencia y tomar decisiones simples sobre ajustes calóricos. La app debe convertir ese proceso repetitivo en una experiencia mucho más cómoda, visual, consistente y escalable.

Además de ser una herramienta de seguimiento personal, la app también debe incorporar una capa de **comunidad y motivación**, con funcionalidades sociales y gamificación, para aumentar adherencia, frecuencia de uso y sensación de progreso.

---

## Visión de producto

La app debe combinar 4 pilares en un único producto coherente:

1. **Seguimiento diario de nutrición**

   * Registro de comidas.
   * Estimación de calorías y macronutrientes.
   * Control diario de objetivos.
   * Resumen del día y evaluación.

2. **Seguimiento corporal y de progreso**

   * Peso corporal.
   * Medidas corporales.
   * Fotos de progreso.
   * Informes y evaluaciones periódicas.
   * Tendencias semanales y mensuales.

3. **Asistencia inteligente con LLM/API**

   * El usuario describe lo que ha comido en lenguaje natural.
   * Un LLM estima calorías, proteína, hidratos y grasas.
   * El sistema devuelve resultados útiles pero revisables.
   * El sistema aprende del contexto del usuario, sus hábitos y sus objetivos.

4. **Capa social + gamificación**

   * Feed de publicaciones públicas.
   * Sistema de seguimiento entre usuarios.
   * Experiencia, niveles, puntos y currency.
   * Recompensas cosméticas o personalización del perfil.

La experiencia debe sentirse **ágil, moderna, clara y muy usable**, con una UX inspirada en apps como Yazio en cuanto a simplicidad, visualización de datos, onboarding limpio y sensación de control diario.

---

## Problema que resuelve

Muchas personas que intentan ganar músculo o mejorar su físico fallan no por falta de intención, sino por fricción operativa:

* registrar comida da pereza;
* calcular macros es lento;
* interpretar si un día ha ido bien o mal no siempre es fácil;
* hacer seguimiento del peso y las fotos queda disperso;
* cuesta mantener la motivación durante meses;
* las apps existentes suelen quedarse en un extremo: o son muy técnicas, o muy genéricas, o poco motivadoras, o poco adaptadas al seguimiento real que hace la gente que entrena.

Esta app debe resolver esa fricción con una combinación de **automatización inteligente, contexto personal, visualización simple y motivación sostenida**.

---

## Perfil de usuario principal inicial

El usuario principal inicial es una persona que:

* entrena fuerza de manera regular;
* quiere ganar masa muscular con el menor aumento de grasa posible;
* necesita controlar calorías y macros con bastante precisión, pero sin una experiencia pesada;
* quiere registrar peso y progreso físico;
* agradece recomendaciones accionables y simples;
* puede valorar aspectos sociales y de gamificación si están bien integrados y no distraen del objetivo principal.

Aunque el caso inicial está muy orientado a volumen limpio, el diseño debe ser escalable a otros objetivos físicos y perfiles de usuario.

---

## Principios del producto

1. **Primero útil, luego bonito, luego social**
   La función principal es ayudar a cumplir objetivos físicos reales. Lo social y la gamificación deben apoyar la adherencia, no entorpecer el seguimiento.

2. **Reducir fricción al máximo**
   Registrar una comida o el peso debe requerir el menor esfuerzo posible.

3. **Contexto antes que cálculo aislado**
   La app no solo debe sumar calorías. Debe entender el objetivo del usuario, si entrena o no, su evolución de peso y sus patrones.

4. **Claridad radical**
   El usuario debe entender rápido:

   * cuánto lleva consumido;
   * cuánto le falta;
   * si va bien o mal para su objetivo;
   * qué debería hacer hoy.

5. **Estimaciones útiles, no falsas certezas**
   Las calorías y macros estimados por LLM son aproximaciones. La app debe presentarlas de forma útil, editable y trazable.

6. **Motivación sin infantilizar**
   La gamificación debe ser elegante y adictiva, pero no ridícula. Debe reforzar hábitos valiosos.

---

## Qué debe entender el LLM sobre el dominio

El LLM que participe en refinamiento, diseño o implementación debe asumir que esta app no es simplemente un contador de calorías. Es una plataforma híbrida entre:

* nutrición deportiva,
* tracking de hábitos,
* seguimiento de composición corporal,
* coaching asistido por IA,
* producto social con engagement loops,
* sistema de progresión y recompensas.

Por tanto, cualquier propuesta debe equilibrar:

* precisión funcional,
* buena UX,
* escalabilidad técnica,
* engagement,
* privacidad,
* confianza del usuario.

---

## Funcionalidades núcleo (MVP ampliado)

### 1. Onboarding

* Crear cuenta.
* Elegir objetivo: volumen limpio, mantenimiento, definición, recomposición, pérdida de peso (énfasis báscula; ver `functional_decisions_v1.md`).
* Introducir sexo, edad, altura, peso actual.
* Frecuencia de entrenamiento.
* Nivel de actividad.
* Preferencias nutricionales o restricciones.
* Elegir si quiere perfil público, privado o mixto.

### 2. Dashboard diario

Debe ser la pantalla principal y la más cuidada.

Debe mostrar de forma inmediata:

* calorías objetivo del día;
* calorías consumidas;
* proteína, hidratos y grasas consumidos frente al objetivo;
* progreso visual con barras o anillos;
* si hoy es día de entreno o descanso;
* resumen rápido del estado del día;
* acceso rápido a registrar comida, peso, agua, entrenamiento o nota.

### 3. Registro de comidas

Debe admitir varios modos:

* texto libre tipo chat;
* selección de comidas frecuentes;
* plantillas / comidas guardadas;
* edición manual;
* opcionalmente foto en el futuro.

Flujo ideal:

1. El usuario escribe lo que ha comido.
2. El LLM estima calorías y macros.
3. La app muestra desglose editable.
4. El usuario confirma o corrige.
5. La comida queda registrada y reutilizable.

Cada comida debe almacenar:

* nombre o descripción;
* timestamp;
* calorías estimadas o confirmadas;
* proteína, hidratos, grasas;
* nivel de confianza de la estimación;
* fuente del dato (LLM, manual, plantilla, base de datos, etc.).

### 4. Objetivos dinámicos

El sistema debe permitir configurar o calcular:

* calorías objetivo;
* proteína objetivo;
* grasas mínimas o rango;
* hidratos ajustados según resto;
* objetivos distintos para días de entreno y descanso.

Debe contemplarse lógica de ajuste basada en tendencias de peso y adherencia.

### 5. Resumen del día

Al final del día, la app debe poder ofrecer:

* calorías totales;
* proteína total;
* hidratos totales;
* grasas totales;
* comparación con objetivos;
* evaluación simple del día;
* breve recomendación para el día siguiente.

### 6. Seguimiento corporal

* Registro de peso.
* Vista de tendencia diaria y media móvil.
* Medidas corporales por zonas.
* Fotos de progreso con comparativas temporales.
* Hitos o cambios relevantes.

### 7. Evaluaciones periódicas

Semanal, quincenal o mensual:

* evolución del peso;
* adherencia calórica;
* adherencia proteica;
* tendencia de macros;
* evolución visual y medidas;
* sugerencias de ajuste.

### 8. Feed social

* Publicaciones públicas de usuarios.
* Feed priorizado por usuarios seguidos.
* Posibilidad de publicar progreso, comidas, hitos, fotos o reflexiones.
* Likes, comentarios, guardados o reacciones ligeras.
* Moderación y control de privacidad.

### 9. Sistema de seguimiento social

* Seguir/dejar de seguir.
* Ver perfil de otros usuarios.
* Ver su progreso compartido públicamente.
* Ver logros, rachas, nivel y publicaciones.

### 10. Gamificación

* XP por registrar comidas, completar días, mantener rachas, registrar peso, alcanzar objetivos.
* Niveles.
* Moneda interna.
* Tienda de personalización.
* Recompensas cosméticas de perfil, temas, badges o marcos.

---

## Qué NO debe ser

* No debe parecer una app clínica o fría.
* No debe depender exclusivamente de la precisión absoluta de la IA.
* No debe obligar al usuario a introducir demasiados datos al principio.
* No debe convertir lo social en el centro del producto por encima del seguimiento.
* No debe generar recomendaciones de salud extremas, rígidas o peligrosas.

---

## Rol del LLM dentro del producto

El LLM puede usarse en varias capas:

### A. Estimación nutricional

Interpretar descripciones de comidas y proponer calorías y macros.

### B. Normalización estructurada

Convertir lenguaje natural en objetos estructurados que la app pueda guardar.

### C. Explicación y feedback

Generar evaluaciones breves y comprensibles del día o de la semana.

### D. Asistente contextual

Responder preguntas tipo:

* “¿Cómo voy hoy?”
* “¿Me faltan proteínas?”
* “¿Qué me conviene cenar para cuadrar macros?”
* “¿Estoy subiendo demasiado rápido?”

### E. Ayuda al producto y desarrollo

Ayudar a diseñar flujos, arquitectura, modelos de datos, edge cases, prompts, validaciones y experiencias de usuario.

---

## Requisitos importantes para estimación con IA

El sistema de IA debe diseñarse con cautela. Debe:

* devolver estimaciones estructuradas y consistentes;
* indicar incertidumbre cuando falten cantidades o preparación;
* permitir corrección manual siempre;
* aprender de correcciones futuras si el sistema lo contempla;
* diferenciar entre estimación rápida y dato verificado;
* evitar tono excesivamente seguro cuando la entrada sea ambigua.

Ejemplo conceptual de salida esperada del modelo:

* comida detectada;
* ingredientes inferidos;
* cantidades estimadas;
* calorías;
* proteína;
* hidratos;
* grasas;
* confianza;
* observaciones.

---

## UX deseada

La UX debe transmitir:

* simplicidad;
* claridad visual;
* sensación de progreso;
* control sin fricción;
* motivación diaria.

Referencias aspiracionales:

* simplicidad de apps de tracking modernas;
* dashboards limpios;
* interacciones tipo chat donde aporten valor;
* visualización de métricas sin saturación;
* feed social pulido, no caótico.

Pautas UX:

* muy pocos pasos para registrar una comida;
* feedback inmediato tras registrar algo;
* home centrada en “qué tal va mi día”;
* visualizaciones simples de macros y calorías;
* microcopys útiles y humanos;
* buena jerarquía entre tracking, progreso y social;
* diseño mobile-first.

---

## Privacidad y confianza

La app manejará datos sensibles de salud y progreso físico. Debe contemplar:

* perfiles públicos, privados o híbridos;
* control granular sobre qué se comparte;
* fotos privadas o públicas por separado;
* transparencia sobre qué calcula la IA y qué ha introducido el usuario;
* trazabilidad de estimaciones;
* mecanismos de moderación de contenido social.

---

## Supuestos funcionales iniciales

* El producto será prioritariamente móvil.
* Debe existir backend con usuarios, logs diarios, comidas, métricas corporales, publicaciones, relaciones sociales y economía del sistema.
* La IA se consumirá vía API.
* Debe ser posible evolucionar desde un MVP simple hasta un sistema rico en features.
* El coste de inferencia debe tenerse en cuenta desde el diseño.

---

## Qué se espera del LLM al trabajar sobre este contexto

A partir de este contexto, el LLM debe ser capaz de ayudar en varias fases.

### 1. Refinamiento de producto

Debe ayudar a:

* concretar propuesta de valor;
* definir MVP vs fases posteriores;
* ordenar prioridades;
* identificar riesgos y edge cases;
* diseñar loops de retención y adherencia.

### 2. Diseño funcional

Debe ayudar a:

* definir módulos;
* describir flujos de usuario;
* proponer user stories;
* definir reglas de negocio;
* diseñar sistema de objetivos, progreso y evaluaciones.

### 3. Diseño técnico

Debe ayudar a:

* proponer arquitectura;
* diseñar modelo de datos;
* definir endpoints o contratos;
* integrar API LLM;
* plantear colas, eventos y analítica;
* contemplar seguridad, privacidad y escalabilidad.

### 4. Implementación

Debe ayudar a:

* dividir en epics y tareas;
* generar especificaciones técnicas;
* redactar prompts robustos;
* proponer esquemas JSON;
* escribir código y tests;
* revisar consistencia entre frontend, backend e IA.

---

## Instrucciones para el LLM cuando responda

Cuando trabajes sobre esta app:

1. No des respuestas genéricas.
2. Prioriza decisiones concretas, comparables y justificadas.
3. Separa claramente MVP, V2 y visión futura.
4. Piensa siempre en móvil primero.
5. Equilibra utilidad real, engagement y complejidad técnica.
6. No supongas precisión perfecta en la IA de alimentos.
7. Diseña para datos estructurados, edición manual y trazabilidad.
8. Ten en cuenta privacidad y moderación desde el inicio.
9. Propón soluciones escalables, pero sin sobrediseñar el MVP.
10. Cuando falte contexto, haz supuestos explícitos y razonables.

---

## Preguntas estratégicas que el LLM debería ayudar a resolver después

* ¿Cuál es el MVP real que aporta valor en 4–8 semanas?
* ¿Qué parte debe hacerse deterministicamente y qué parte con LLM?
* ¿Cómo diseñar el flujo de registro de comidas para que sea rápido y fiable?
* ¿Cómo calcular objetivos y ajustes sin volver la app demasiado compleja?
* ¿Qué modelo de datos soporta bien tracking diario + social + gamificación?
* ¿Cómo diseñar el sistema de XP y currency para incentivar hábitos útiles?
* ¿Qué se comparte en el feed y con qué controles de privacidad?
* ¿Cómo hacer evaluaciones automáticas útiles sin prometer exactitud falsa?
* ¿Cómo reducir coste de IA manteniendo buena experiencia?
* ¿Qué métricas de producto indican adherencia y éxito?

---

## Resultado esperado final

El objetivo no es solo construir una app bonita, sino un producto que:

* ayude de verdad a seguir una estrategia nutricional y física;
* reduzca fricción diaria;
* aumente adherencia;
* convierta datos dispersos en decisiones claras;
* haga que el seguimiento del progreso sea sostenible y motivador;
* combine utilidad, identidad y comunidad.

---

## Prompt de arranque sugerido para usar este contexto con otro LLM

Usa el contexto anterior como base de producto. Quiero que actúes como un experto en producto digital, UX, arquitectura de software y sistemas con LLM. Tu trabajo es ayudarme a convertir esta idea en una app real.

Primero:

1. resume la propuesta de valor con precisión;
2. define un MVP realista;
3. separa MVP, V2 y visión futura;
4. propón la arquitectura funcional del producto;
5. define los módulos principales;
6. lista riesgos, decisiones críticas y dudas abiertas.

Después, en siguientes iteraciones, te pediré diseño UX, modelo de datos, arquitectura técnica, prompts, endpoints y plan de implementación.
