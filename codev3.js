console.clear();

function createToken(collection, modeId, type, name, value) {
  const token = figma.variables.createVariable(name, collection, type);
  token.setValueForMode(modeId, value);
  return token;
}

/**
 * For the purpose of resolving an alias a token is created
 */
function createVariable(collection, modeId, key, valueKey, tokens) {
  const token = tokens[valueKey];
  return createToken(collection, modeId, token.resolvedType, key, {
    type: "VARIABLE_ALIAS",
    id: `${token.id}`,
  });
}

function processAliases({ collection, modeId, aliases, tokens }) {
  aliases = Object.values(aliases);
  let depth = aliases.length;

  //loop for nested aliases
  while (aliases.length && depth > 0) {
    for (let i = 0; i < aliases.length; i++) {
    
      const { key, type, valueKey } = aliases[i];

      const token = tokens[valueKey];
      if (token) {
        aliases.splice(i, 1); 
        tokens[key] = createVariable(collection, modeId, key, valueKey, tokens);
      }
    }
    depth--;
  }
}

function isAlias(value) {
  return value.toString().trim().charAt(0) === "{";
}

async function parseVariable(collection, modeValue, variable) {
  variable.name = variableNameToCSS(variable.name);

  if (isNumeric(variable, modeValue)) { //for float values+ px handling
    return handleNumeric

  } else if (isDefinedColour(variable, modeValue)) { //for colours
    return handleColour(variable);

  } else if (isString(variable, modeValue)) { //for strings
    return handleString(variable)

  } else if (isBoolean(variable, modeValue)) { //for booleans, same as for string
    return handleBoolean(variable)

  } else {
    return handleAlias(variable); //else if it's an alias
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
    console.log(`--${variable.name}: ${processedValue};`);
    return processedValue;
  }
  console.log(`Invalid value: ${variable.name}`)
  
}

/**
 * For not aliased colours 
 */
function isDefinedColour(variable, modeValue) {
  return variable.type === "COLOR" && modeValue !== undefined;
}

/**
 * For colour variable handling -> converts to hex and resolves aliases
 */
async function handleColour(variable) {
  const colorValue = variable.valuesByMode[Object.keys(variable.valuesByMode)[0]];

  if (colorValue && typeof colorValue === "object" && "r" in colorValue && "g" in colorValue && "b" in colorValue) { //in rgb format in json
    const colorHex = rgbToHex(colorValue);
    console.log(`--${variable.name}: ${colorHex};`);
    return colorHex;

  } else {
    return await resolveAlias(variable); //if an alias resolve and return
  }
}

async function resolveAlias(variable) {
  const aliasVariable = await figma.variables.getVariableByIdAsync(variable.valuesByMode[Object.keys(variable.valuesByMode)[0]].id);
  const resolvedAlias = variableNameToCSS(aliasVariable.name);
  console.log(`--${variable.name}: (--var-${resolvedAlias});`);
  return `--var-${resolvedAlias}`;
}

function isDefaultColor(variable, modeValue) {
  return variable.type === "COLOR" && modeValue !== undefined;
}

function handleAlias(variable) {
  console.log(variable);
  return variable;
}

function isString(variable, modeValue) {
  return variable.type === "STRING" && modeValue !== undefined;
}

function handleString(variable) {
  const value = variable.valuesByMode[Object.keys(variable.valuesByMode)[0]]
  console.log(`--${variable.name}: ${value};`);
  return variable
}
function isBoolean(variable, modeValue) {
  return variable.type === "BOOLEAN" && modeValue !== undefined;
}

function handleBoolean(variable) {
  const value = variable.valuesByMode[Object.keys(variable.valuesByMode)[0]];
  const boolString = value === true ? 'true' : 'false';
  console.log(`--${variable.name}: ${boolString};`);
  return variable;
}

/**
 * Resolves a given rgb value returning hex
 */
function rgbToHex({ r, g, b, a }) {
  const toHex = (value) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  // Convert alpha to hex as well
  const alphaHex = a !== 1 ? toHex(a) : "";
  
  const hex = [toHex(r), toHex(g), toHex(b)].join("");
  return `#${hex}${alphaHex}`;
}

figma.ui.onmessage = async (message) => {
  console.log("Received message:", message);
  if (message.type === "EXPORT") {
    try {
      const collections = await figma.variables.getLocalVariableCollectionsAsync();

      const result = [];

      for (const collection of collections) {
        const { name, modes, variableIds } = collection;
        const modeDetails = modes.map((mode) => ({
          name: mode.name,
          id: mode.modeId
        }));

        const variableDetails = await Promise.all(
          variableIds.map(async (variableId) => {
            try {
              const variable = await figma.variables.getVariableByIdAsync(variableId);
              return {
                name: variable.name,
                type: variable.resolvedType,
                valuesByMode: variable.valuesByMode || {},
              };
            } catch (err) {
              console.error(`Failed to fetch: ${variableId}`, err);
              return null;
            }
          })
        );

        result.push({
          collectionName: name,
          modes: modeDetails,
          variables: variableDetails
        });
      }

      const fileStructure = {};

      result.forEach(collection => {
        collection.modes.forEach(mode => {
            const modeDict = {};
            collection.variables.forEach(variable => {
              const modeValue = variable.valuesByMode[mode.id];
              variable = parseVariable(collection, modeValue, variable);
              modeDict[variable.name] = {
                  type: variable.type,
                  value: modeValue
              };
            });

            if (!fileStructure[collection.collectionName]) {
              fileStructure[collection.collectionName] = {};
            }
            fileStructure[collection.collectionName][mode.name] = modeDict;
        });
      });

      console.log(fileStructure);

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