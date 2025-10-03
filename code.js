console.clear();

let skippedVariables = [];
let processedVariables = 0;
let totalVariables = 0;

async function parseVariable(variable, modeValue) {
  const variableName = variableNameToCSS(variable.name);

  const shouldSkip = await filterVariables(variableName);
  if (shouldSkip) return null;

  try {
    //handle aliases
    if (modeValue && modeValue.type === "VARIABLE_ALIAS") {
      const aliasVariable = await figma.variables.getVariableByIdAsync(
        modeValue.id
      );
      if (!aliasVariable) return null;

      const aliasName = variableNameToCSS(aliasVariable.name);

      //filter variables that are not meant to be exported
      const skipAlias = await filterVariables(aliasName);
      if (skipAlias) return null;

      return `--${variableName}: var(--${aliasName});`;
    }

    return await handleVariableByType(variable, modeValue, variableName);
  } catch (err) {
    console.error(`error parsing variable ${variableName}:`, err);
    return null;
  }
}

/**
 * Decides if a variable should be exported based on predefined conditions
 * NOT EXPORTED:
 * - Display variables containing the word "visible"
 * - Variables containing "UX" in the name
 */
async function filterVariables(variableName) {
  const lower = variableName.toLowerCase();

  if (lower.includes("display") && lower.includes("visible")) {
    return true;
  }

  if (lower.includes("ux")) {
    return true;
  }

  return false;
}

async function handleVariableByType(variable, modeValue, variableName) {
  switch (variable.resolvedType) {
    case "FLOAT":
      return handleNumeric(modeValue, variableName);
    case "COLOR":
      return handleColor(modeValue, variableName);
    case "STRING":
      return handleString(modeValue, variableName);
    case "BOOLEAN":
      return handleBoolean(modeValue, variableName);
    default:
      console.error(
        `unhandled variable type: ${variable.resolvedType} for ${variableName}`
      );
      return null;
  }
}

function variableNameToCSS(name) {
  return name.replace(/\//g, "-").replace(/\s+/g, "-");
}

function handleNumeric(value, variableName) {
  const numericValue = parseFloat(value);
  if (isNaN(numericValue)) return null;

  const skipPx = /bold|weight|regular|visibility|radius/i.test(variableName);
  const suffix = skipPx ? "" : "px";
  return `--${variableName}: ${numericValue}${suffix};`;
}

function handleColor(value, variableName) {
  if (!value || typeof value !== "object" || !("r" in value)) return null;

  const colorHex = rgbToHex(value);
  return `--${variableName}: ${colorHex};`;
}

function handleString(value, variableName) {
  if (typeof value !== "string") return null;

  if (/font-family|font-ad/i.test(variableName)) {
    //for handling font names with potential white spaces
    return `--${variableName}: "${value}";`;
  }

  return `--${variableName}: ${value.toLowerCase()};`;
}

function handleBoolean(value, variableName) {
  // variables in display refering to visibility are UX/UI only, not to be exported
  const isVisible = /visible/i.test(variableName.toLowerCase());
  const isDisplay = /display/i.test(variableName.toLowerCase());

  if (isDisplay && isVisible) {
    console.log("skipping", variableName);
    return null;
  }

  if (isDisplay) {
    return `--${variableName}: ${value === true ? "inline-block" : "none"};`;
  }

  return `--${variableName}: ${value};`;
}

function rgbToHex({ r, g, b, a = 1 }) {
  const toHex = (value) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  if (a === 0) {
    return `transparent`; //handles rgba in case of 100% transparency
  }

  if (a !== 1) {
    return `rgba(${[r, g, b]
      .map((n) => Math.round(n * 255))
      .join(", ")}, ${a.toFixed(2)})`;
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

figma.ui.onmessage = async (message) => {
  if (message.type === "EXPORT") {
    try {
      const collections =
        await figma.variables.getLocalVariableCollectionsAsync();
      const result = {};
      const modesToExport = new Set([
        "Onet",
        "Medonet",
        "Zielony Onet",
        "Komputer Świat",
        "Auto Świat",
        "Lifestyle",
        "Przegląd Sportowy",
        "Business Insider",
      ]); //TODO: update once new schemas are defined and ready for dev

      const allVariableIds = collections.flatMap(
        (collection) => collection.variableIds
      );

      const allVariables = await Promise.all(
        allVariableIds.map(async (id) => {
          try {
            const variable = await figma.variables.getVariableByIdAsync(id);
            return { id, variable };
          } catch (err) {
            console.error(`failed to fetch variable ${id}:`, err);
            return { id, variable: null };
          }
        })
      );

      const variableMap = new Map();
      allVariables.forEach(({ id, variable }) => {
        variableMap.set(id, variable);
      });

      for (const collection of collections) {
        const { name, modes, variableIds } = collection;
        const filteredModes = modes.filter(
          (mode) => modesToExport.has(mode.name) || mode.name === "Premium"
        ); //filtering based on mode name, Premium variables should always be exportable

        if (filteredModes.length === 0) continue;

        result[name] = {};
        console.log(`exporting collection: ${name}`);
        console.log(`total variables to process: ${variableIds.length}`);

        const modePromises = filteredModes.map(async (mode) => {
          const modeResults = [];

          for (const variableId of variableIds) {
            const variable = variableMap.get(variableId);

            if (!variable) {
              skippedVariables.push({
                id: variableId,
                name: null,
                reason: "variable not found",
              });
              continue;
            }

            const modeValue = variable.valuesByMode[mode.modeId];
            const parsedVariable = await parseVariable(variable, modeValue);

            if (parsedVariable) {
              modeResults.push(parsedVariable);
            } else {
              skippedVariables.push({
                id: variableId,
                name: variable.name,
                mode: mode.name,
                reason: "failed to parse variable",
              });
            }
          }

          return { modeName: mode.name, results: modeResults };
        });

        const completedModes = await Promise.all(modePromises);

        completedModes.forEach(({ modeName, results }) => {
          if (results.length > 0) {
            result[name][modeName] = results;
          }
        });

        if (Object.keys(result[name]).length === 0) {
          delete result[name];
        }
      }

      figma.ui.postMessage({
        type: "EXPORT_RESULT",
        data: result,
        skippedVariables: skippedVariables,
      });
    } catch (err) {
      console.error("export error:", err);
      figma.ui.postMessage({ type: "EXPORT_ERROR", error: err.message });
    }
  }
};

if (figma.command === "export") {
  figma.showUI(__uiFiles__["export"], {
    width: 500,
    height: 650,
    themeColors: true,
  });
}
