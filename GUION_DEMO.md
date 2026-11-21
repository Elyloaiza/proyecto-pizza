# Guion de demostración (≈ 8 minutos)

Mantenga separados los **datos reales del caso** (conjunto inicial) y la **demostración** (archivos con «demo» en el nombre, que activan la etiqueta «Datos de demostración»).

Cifras de referencia con el conjunto inicial real: ventas 1.357.881,66 USD · utilidad bruta 813.713,76 · margen 59,9 % · ticket 29,58 · 1.000 clientes · 45.900 transacciones.

## 1. Indicadores (1 min)
1. Abrir **Dashboard**. Señalar período, origen («Datos reales del caso»), fecha de carga y moneda.
2. Leer los seis KPIs y abrir un «?» (por ejemplo, ticket promedio y margen bruto) para mostrar la definición.
3. Mostrar la nota de base de costo: «histórico registrado en cada venta».

## 2. Filtros (1,5 min)
1. Ciudad = Dallas → ventas 330.545,67 y 11.540 transacciones.
2. Añadir sucursal, segmento, producto y fechas: ver cómo cambian KPIs, gráficos y tablas; mostrar los chips de filtros activos.
3. Elegir una combinación sin ventas para mostrar el mensaje «Sin resultados» y pulsar **Limpiar filtros**.
4. En sucursales: mejor/peor por utilidad bruta y cambiar el criterio a ventas o margen. En productos: «mayor utilidad» frente a «mayor margen» y frente a «más vendido».

## 3. Sustitución del archivo de ventas (2 min)
1. Ir a **Datos**: leer el aviso «las cargas actualizan solo este navegador».
2. Cargar `Ventas_demo_invalida.csv` → mostrar errores con hoja y fila y que no se puede confirmar (datos previos intactos).
3. Cargar `Ventas_demo_formatos_ambiguos.csv` → el importador pide elegir formato de fecha y número.
4. Cargar `Ventas_demo_actualizacion_2025.csv` → revisar vista previa y mapeo propuesto → **Confirmar y reemplazar**.
5. Volver al Dashboard: ventas 574.105,40 y 19.500 transacciones (reemplazo, no acumulación); aparece «Datos de demostración». Repetir la carga: las cifras no cambian.
6. Recargar la página (persisten) y pulsar **Restaurar datos iniciales** (vuelven 1.357.881,66).

## 3b. Verificación con resultado conocido (opcional, 30 s)
Cargar los tres CSV de `ejemplos/prueba_pequena/`: ventas 50, costo 28, utilidad 22, margen 44 %, ticket 25, 2 clientes, 2 transacciones; filtrando el producto A: 30 / 12 / 40 % / ticket 15.

## 4. Chat (2 min)
1. Con datos iniciales, abrir **Asistente IA** y mostrar el contexto actual (versión de datos, filtros).
2. Pulsar la consulta 1 (**cinco hallazgos**). Mostrar el tipo (hallazgo / interpretación / recomendación), las evidencias E# y expandir una para ver la tabla de origen.
3. Pulsar la consulta 5 (**cinco decisiones**): mostrar acción, evidencia, justificación y supuesto o limitación.
4. Cambiar un filtro en el Dashboard y volver al chat: las respuestas previas quedan marcadas «Contexto anterior».
5. **Copiar conversación y evidencias** para el documento ejecutivo.

## 5. Valoración crítica (1 min)
- Las recomendaciones no son conclusiones: contrastarlas con la tabla de evidencia y con las limitaciones (utilidad **bruta**, precios y costos de ventas distintos del catálogo, 2025 con menos transacciones por mes que 2024, sin información de gastos operativos).
- Anotar qué afirmaciones del modelo no se pudieron verificar.

> Antes de grabar: confirmar que el asistente está configurado (sin el aviso «pendiente de configuración») y probar las cinco consultas. Los cinco hallazgos y las cinco decisiones del documento deben salir de esas respuestas **verificadas por el equipo**, no de este guion.
