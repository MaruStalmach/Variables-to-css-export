console.clear();

let skippedVariables = [];
let processedVariables = 0;
let totalVariables = 0;

async function parseVariable(variable, modeValue) {
  const variableName = variableNameToCSS(variable.name);

  //for boolean handling 
  if (modeValue === undefined || modeValue === null) {
    if (variable.resolvedType === "BOOLEAN") {
      //defaults to false if nothing is specified
      return `--${variableName}: false;`;
    } else {
      console.error(`No modeValue found for variable: ${variableName}`);
      return null;
    }
  }

  try {
    if (modeValue.type === "VARIABLE_ALIAS") {
      return await resolveAlias(variable, variableName, modeValue);
    }

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
        console.error(`Unhandled variable type: ${variable.resolvedType} for ${variableName}`);
        return null;
    }
  } catch (err) {
    console.error(`Error parsing variable ${variableName}:`, err);
    return null;
  }
}

async function resolveAlias(variable, variableName, modeValue) {
  if (!modeValue || !modeValue.id) {
    return null;
  }

  try {
    const aliasVariable = await figma.variables.getVariableByIdAsync(modeValue.id);
    if (!aliasVariable) return null;

    const resolvedAlias = variableNameToCSS(aliasVariable.name);
    return `--${variableName}: var(--${resolvedAlias});`;
  } catch (err) {
    console.error("Failed to resolve alias:", err);
    return null;
  }
}

function variableNameToCSS(name) {
  return name.replace(/\//g, "-").replace(/\s+/g, "-");
}

function handleNumeric(value, variableName) {
  const numericValue = parseFloat(value);
  if (isNaN(numericValue)) return null;

  const skipPx = /bold|weight|regular|visibility/i.test(variableName);
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
  if (/font-family|font-ad/i.test(variableName)) { //for handling font names with potential white spaces
    return `--${variableName}: "${value}";`;
  }
  return `--${variableName}: ${value};`; 
}

function handleBoolean(value, variableName) {
  const isVisibility = /visibility/i.test(variableName.toLowerCase()) //handles boolean variables connected with obj visibility
  
  if (isVisibility) {
    console.log("INLINE BLOCK")
    return `--${variableName}: ${value === true ? "inline-block" : "none"};`; //TODO: adjust if needed if bool variables are to be used in different contexts
  }

  return `--${variableName}: ${value === true ? "true" : "false"};`;
}

function rgbToHex({ r, g, b, a = 1 }) {
  const toHex = (value) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  if (a === 0) {
    return `transparent`;
  }

  if (a !== 1) {
    return `rgba(${[r, g, b].map(n => Math.round(n * 255)).join(", ")}, ${a.toFixed(2)})`;
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

figma.ui.onmessage = async (message) => {
  if (message.type === "EXPORT") {
    try {
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      const result = {};

      for (const collection of collections) {
        const { name, modes, variableIds } = collection;
        result[name] = {};

        skippedVariables = [];
        processedVariables = 0;
        totalVariables = variableIds.length;

        console.log(`Exporting Collection: ${name}`);
        console.log(`Total variables to process: ${totalVariables}`);

        for (const mode of modes) {
          result[name][mode.name] = [];
        }

        for (const variableId of variableIds) {
          const variable = await figma.variables.getVariableByIdAsync(variableId);
          if (!variable) {
            skippedVariables.push({ id: variableId, reason: "Variable not found" });
            continue;
          }

          if (variable.name.toLowerCase().includes('ux')) {
            skippedVariables.push({ 
              id: variableId, 
              name: variable.name, 
              reason: "Contains 'ux' in name" 
            });
            continue;
          }

          for (const mode of modes) {
            const modeValue = variable.valuesByMode[mode.modeId];
            const parsedVariable = await parseVariable(variable, modeValue);
            
            if (parsedVariable) {
              //add to mode
              result[name][mode.name].push(parsedVariable);
              
              processedVariables++;
            } else {
              skippedVariables.push({
                id: variableId,
                name: variable.name,
                mode: mode.name,
                reason: "Failed to parse variable"
              });
            }
          }
        }

        console.log(`Processed Variables: ${processedVariables}`);
        console.log(`Skipped Variables: ${skippedVariables.length}`);
        console.log('Skipped Variable Details:', skippedVariables);

        for (const modeName in result[name]) {
          if (result[name][modeName].length === 0) {
            delete result[name][modeName];
          }
        }
        if (Object.keys(result[name]).length === 0) {
          delete result[name];
        }
      }

      figma.ui.postMessage({ 
        type: "EXPORT_RESULT", 
        data: result,
        skippedVariables: skippedVariables
      });
    } catch (err) {
      console.error("Export error:", err);
      figma.ui.postMessage({ type: "EXPORT_ERROR", error: err.message });
    }
  }
};

if (figma.command === "export") {
  figma.showUI(__uiFiles__["export"], {
    width: 500,
    height: 550,
    themeColors: true,
  });
}

