// Regenera public/plantillas/*.csv y el diccionario desde src/lib/schema.ts
import { writeFileSync } from 'node:fs';
import { dictionaryCsv, KIND_LABEL, templateCsv } from '../src/lib/schema';
import type { DatasetKind } from '../src/lib/types';
for (const k of ['sales', 'customers', 'products'] as DatasetKind[]) writeFileSync(`public/plantillas/plantilla_${KIND_LABEL[k].toLowerCase()}.csv`, '﻿' + templateCsv(k));
writeFileSync('public/plantillas/diccionario_de_campos.csv', '﻿' + dictionaryCsv());
console.log('Plantillas generadas');
