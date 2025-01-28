console.clear();

async function parseVariable(modeValue, variable) {
  variable.name = variableNameToCSS(variable.name);

  if (isNumeric(variable, modeValue)) {
    variable = handleNumeric(variable, modeValue);
    return variable;
  } else if (isDefinedColour(variable, modeValue)) {
    variable = await handleColour(variable);
    return variable;
  } else if (isString(variable, modeValue)) {
    variable = handleString(variable);
    return variable;
  } else if (isBoolean(variable, modeValue)) {
    variable = handleBoolean(variable);
    return variable;
  } else {
    variable = await resolveAlias(variable);  // Resolve alias if it's an alias
    return variable;
  }
}

function variableNameToCSS(name) {
  return name.replaceAll("/", "-");
}

function isNumeric(variable, modeValue) {
  return variable.type === "FLOAT" && modeValue !== undefined;
}

function handleNumeric(variable, modeValue) {
  const shouldAddPx = /bold|weight|regular/i.test(variable.name);
  const numericValue = parseFloat(modeValue);
  if (shouldAddPx && !isNaN(numericValue)) {
    const processedValue = `${numericValue}px`;
    return `--${variable.name}: ${processedValue};`;
  } else {
    return `--${variable.name}: ${numericValue};`;
  }
}

function isDefinedColour(variable, modeValue) {
  return variable.type === "COLOR" && modeValue !== undefined;
}

async function handleColour(variable) {
  const colorValue = variable.valuesByMode[Object.keys(variable.valuesByMode)[0]];

  if (colorValue && typeof colorValue === "object" && "r" in colorValue && "g" in colorValue && "b" in colorValue) {
    const colorHex = rgbToHex(colorValue);
    return `--${variable.name}: ${colorHex};`;
  } else {
    const resolved = await resolveAlias(variable);
    return `--${variable.name}: ${resolved};`;
  }
}

async function resolveAlias(variable) {
  const aliasVariable = await figma.variables.getVariableByIdAsync(variable.valuesByMode[Object.keys(variable.valuesByMode)[0]].id);
  const resolvedAlias = variableNameToCSS(aliasVariable.name);
  return `(--var-${resolvedAlias})`;
}

function isString(variable, modeValue) {
  return variable.type === "STRING" && modeValue !== undefined;
}

function handleString(variable) {
  const value = variable.valuesByMode[Object.keys(variable.valuesByMode)[0]];
  return `--${variable.name}: ${value};`;
}

function isBoolean(variable, modeValue) {
  return variable.type === "BOOLEAN" && modeValue !== undefined;
}

function handleBoolean(variable) {
  const value = variable.valuesByMode[Object.keys(variable.valuesByMode)[0]];
  const boolString = value === true ? 'true' : 'false';
  return `--${variable.name}: ${boolString};`;
}

function rgbToHex({ r, g, b, a }) {
  const toHex = (value) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  const alphaHex = a !== 1 ? toHex(a) : "";
  const hex = [toHex(r), toHex(g), toHex(b)].join("");
  return `#${hex}${alphaHex}`;
}

figma.ui.onmessage = async (message) => {
  console.log("Received message:", message);
  if (message.type === "EXPORT") {
    try {
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      const result = {};

      for (const collection of collections) {
        const { name, modes, variableIds } = collection;
        
        // Initialize the collection entry in the result
        result[name] = {};

        // Loop over modes for this collection
        for (const mode of modes) {
          const modeVariable = [];

          // Fetch variables for each mode
          for (const variableId of variableIds) {
            try {
              const variable = await figma.variables.getVariableByIdAsync(variableId);
              const modeValue = variable.valuesByMode[mode.modeId];
              
              // Process the variable based on its type
              const parsedVariable = await parseVariable(modeValue, variable);

              // Store the result in the modeVariable array
              modeVariable.push(parsedVariable);
            } catch (err) {
              console.error(`Failed to fetch: ${variableId}`, err);
            }
          }

          // Add the array of parsed variables for the current mode
          result[name][mode.name] = modeVariable;
        }
      }

      // Send the final result to the UI
      figma.ui.postMessage({ type: "EXPORT_RESULT", data: result });
    } catch (err) {
      console.error("Export error:", err);
      figma.ui.postMessage({ type: "EXPORT_ERROR", error: err.message });
    }
  }
};


if (figma.command === "export") {
  figma.showUI(__uiFiles__["export"], {
    width: 500,
    height: 500,
    themeColors: true,
  });
}