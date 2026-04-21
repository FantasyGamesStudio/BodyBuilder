import type { ChatCompletionTool } from "openai/resources/chat/completions";

/** Function tools para el asesor (OpenAI Chat Completions API). */
export const ADVISOR_CHAT_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_meal_entries",
      description:
        "Registra una o varias entradas de comida en el diario del usuario. " +
        "Llama a esta función siempre que el usuario describa o muestre (foto) algo que comió, " +
        "está comiendo o va a comer. Desglosa en entradas individuales (ej. bocadillo + café = 2 entradas).",
      parameters: {
        type: "object",
        required: ["entries"],
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "mealSlot", "quantityG", "kcal", "proteinG", "fatG", "carbsG"],
              properties: {
                name: { type: "string", description: "Nombre del alimento (ej. 'Bocadillo de jamón serrano')" },
                mealSlot: {
                  type: "string",
                  enum: ["breakfast", "lunch", "dinner", "snack", "other"],
                  description: "Momento del día. Infiere del contexto si no se indica.",
                },
                quantityG: { type: "number", description: "Cantidad en gramos (o ml para líquidos)" },
                kcal: { type: "number", description: "Calorías totales estimadas" },
                proteinG: { type: "number", description: "Proteínas en gramos" },
                fatG: { type: "number", description: "Grasas en gramos" },
                carbsG: { type: "number", description: "Carbohidratos en gramos" },
              },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_meal",
      description:
        "Valida una propuesta de comida contra los objetivos de macros restantes del día. " +
        "Úsala SIEMPRE ANTES de presentar al usuario una propuesta de comida con gramos concretos. " +
        "Pasta de trigo y arroz blanco para COCINAR en casa: nombres **pasta seca cruda** y **arroz blanco crudo** con gramos SECOS; " +
        "para sobras ya hechas: **pasta cocida**, **arroz cocido** con gramos cocidos. " +
        "El backend calculará los macros reales desde la base de datos, comparará con RESTANTE y devolverá OK o REFINE. " +
        "También puede marcar REFINE si la composición del plato es mala (ej. muy poca proteína principal vs mucho carb refinado " +
        "o demasiado aceite en ese contexto). Si te responde REFINE, reequilibra y llámala de nuevo (máx. 3 intentos).",
      parameters: {
        type: "object",
        required: ["foods"],
        properties: {
          foods: {
            type: "array",
            description: "Lista de alimentos propuestos para esta comida, con los gramos exactos que quieres proponer.",
            items: {
              type: "object",
              required: ["name", "grams"],
              properties: {
                name: {
                  type: "string",
                  description:
                    "Nombre en español reconocido por la base: p. ej. pasta seca cruda, arroz blanco crudo, pasta cocida, arroz cocido, " +
                    "huevo entero, queso fresco batido, aceite de oliva, leche entera, pechuga de pollo cocida.",
                },
                grams: {
                  type: "number",
                  description: "Gramos: para pasta seca cruda y arroz blanco crudo son gramos SECOS antes de cocinar.",
                },
              },
            },
          },
        },
      },
    },
  },
];
