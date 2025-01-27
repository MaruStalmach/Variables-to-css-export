console.clear();

function createCollection(name) {
  const collection = figma.variables.createVariableCollection(name);
  const modeId = collection.modes[0].modeId;
  return { collection, modeId };
}

function createToken(collection, modeId, type, name, value) {
  const token = figma.variables.createVariable(name, collection, type);
  token.setValueForMode(modeId, value);
  return token;
}

function createVariable(collection, modeId, key, valueKey, tokens) {
  const token = tokens[valueKey];
  return createToken(collection, modeId, token.resolvedType, key, {
    type: "VARIABLE_ALIAS",
    id: `${token.id}`,
  });
}


function processAliases({ collection, modeId, aliases, tokens }) {
  aliases = Object.values(aliases);
  let generations = aliases.length;
  while (aliases.length && generations > 0) {
    for (let i = 0; i < aliases.length; i++) {
      const { key, type, valueKey } = aliases[i];
      const token = tokens[valueKey];
      if (token) {
        aliases.splice(i, 1);
        tokens[key] = createVariable(collection, modeId, key, valueKey, tokens);
      }
    }
    generations--;
  }
}

function isAlias(value) {
  return value.toString().trim().charAt(0) === "{";
}

function traverseToken({
  collection,
  modeId,
  type,
  key,
  object,
  tokens,
  aliases,
}) {
  type = type || object.$type;
  // if key is a meta field, move on
  if (key.charAt(0) === "$") {
    return;
  }
  if (object.$value !== undefined) {
    if (isAlias(object.$value)) {
      const valueKey = object.$value
        .trim()
        .replace(/\./g, "/")
        .replace(/[\{\}]/g, "");
      if (tokens[valueKey]) {
        tokens[key] = createVariable(collection, modeId, key, valueKey, tokens);
      } else {
        aliases[key] = {
          key,
          type,
          valueKey,
        };
      }
    } else if (type === "color") {
      tokens[key] = createToken(
        collection,
        modeId,
        "COLOR",
        key,
        parseColor(object.$value)
      );
    } else if (type === "number") {
      tokens[key] = createToken(
        collection,
        modeId,
        "FLOAT",
        key,
        object.$value
      );
    } else {
      console.log("unsupported type", type, object);
    }
  } else {
    Object.entries(object).forEach(([key2, object2]) => {
      if (key2.charAt(0) !== "$") {
        traverseToken({
          collection,
          modeId,
          type,
          key: `${key}/${key2}`,
          object: object2,
          tokens,
          aliases,
        });
      }
    });
  }
}

async function exportToJSON() {
    try {
      console.log("Fetching variable collections... in exportJSON");
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      console.log("Fetched collections:", collections);
      console.log("Fetched:", figma.variables[collections])
  
      const variables = [];
  
      for (const collection of collections) {
        try {
          const { name, modes, variableIds } = collection;
          console.log(`Processing collection: ${name}`);
  
          const modeNames = modes.map((mode) => mode.name); // Get mode names
          const variableDetails = [];
  
          for (const variableId of variableIds) {
            try {
              const variable = await figma.variables.getVariableByIdAsync(variableId);
              console.log("Fetched variable:", variable);
              variableDetails.push({
                name: variable.name,
                type: variable.resolvedType,
                valuesByMode: variable.valuesByMode,
              });
            } catch (err) {
              console.error(`Failed to fetch variable with ID: ${variableId}`, err);
            }
          }
  
          variables.push({
            collectionName: name,
            modes: modeNames,
            variables: variableDetails,
          });
        } catch (err) {
          console.error(`Error processing collection: ${collection.name}`, err);
        }
      }
  
      console.log("Sending variables to UI...");
      figma.ui.postMessage({ type: "EXPORT_RESULT", variables });
    } catch (err) {
      console.error("Error in exportToJSON:", err);
    }
  }
  

// async function processCollection({ name, modes, variableIds }) {
//     const files = {};
//     try {
//       for (const mode of modes) {
//         files[mode.name] = {};
//         for (const variableId of variableIds) {
//           try {
//             const { name, resolvedType, valuesByMode } =
//               await figma.variables.getVariableByIdAsync(variableId);
//             const value = valuesByMode[mode.modeId];
//             if (value !== undefined && ["COLOR", "FLOAT"].includes(resolvedType)) {
//               let obj = files[mode.name];
//               name.split("/").forEach((groupName) => {
//                 obj[groupName] = obj[groupName] || {};
//                 obj = obj[groupName];
//               });
//               obj.$type = resolvedType === "COLOR" ? "color" : "number";
//             }
//           } catch (error) {
//             console.error(`Error processing variable ID ${variableId}:`, error);
//           }
//         }
//       }
//     } catch (error) {
//       console.error("Error in processCollection:", error);
//     }
//     return files;
//   }
  

figma.ui.onmessage = async (message) => {
    console.log("Received message:", message);
  
    if (message.type === "EXPORT") {
      try {

        //gets the collection
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
                console.error(`Failed to fetch variable: ${variableId}`, err);
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
            // console.log("value: ", variable)
            variable = parseVariable(variable, modeValue)
            // console.log("HERE",variable)
            // {name: 'font/paragraph/text5mobile/size', type: 'FLOAT', valuesByMode: {…}}
            modeDict[variable.name] = {
                type: variable.type,
                value: modeValue
            };
            });

            // Use collection name and mode name as nested keys
            if (!fileStructure[collection.collectionName]) {
            fileStructure[collection.collectionName] = {};
            }
            fileStructure[collection.collectionName][mode.name] = modeDict;
        });
        });

        console.log(fileStructure)
  
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
  
  async function parseVariable(variable, modeValue) {
    variable.name = variable.name.replaceAll("/", "-");


    // Check for specific conditions to add 'px'
    const shouldAddPx = /bold|weight|regular|visibility|/i.test(variable.name);

    if (shouldAddPx && variable.type === "FLOAT" && modeValue !== undefined) {
        const numericValue = parseFloat(modeValue);
        if (!isNaN(numericValue)) {
          const processedValue = `${numericValue}px`;
          console.log(`--${variable.name}: ${processedValue};`);
          return processedValue;
        } else {
          const parsedAlias = variable.value
          console.log(parsedAlias)
        }
      
    } else if (variable.type === "COLOR" && modeValue !== undefined) {
        const colorValue = variable.valuesByMode[Object.keys(variable.valuesByMode)[0]];
        if (colorValue && typeof colorValue === "object" && "r" in colorValue && "g" in colorValue && "b" in colorValue) {
            // Convert the color object to HEX
            const colorHex = rgbToHex(colorValue);
            console.log(`--${variable.name}: ${colorHex};`);
            return colorHex;
        } else {
          const variableType = variable.valuesByMode[Object.keys(variable.valuesByMode)[0]]
          const aliasID = variableType.id;
          variable.value = processAliases()
        }
      } else if (variable.type === "COLOR" && modeValue !== undefined){
        const defaultValue = variable.valuesByMode[Object.keys(variable.valuesByMode)[0]];
        console.log(`--${variable.name}: ${defaultValue};`);
      } else {
        const parsedAlias = variable
        console.log(parsedAlias)
      }
    }



function rgbToHex({ r, g, b, a }) {
  if (a !== 1) {
    return `rgba(${[r, g, b]
      .map((n) => Math.round(n * 255))
      .join(", ")}, ${a.toFixed(4)})`;
  }
  const toHex = (value) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  const hex = [toHex(r), toHex(g), toHex(b)].join("");
  return `#${hex}`;
}
function parseColor(color) {
  color = color.trim();
  const rgbRegex = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;
  const rgbaRegex =
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/;
  const hslRegex = /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/;
  const hslaRegex =
    /^hsla\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*,\s*([\d.]+)\s*\)$/;
  const hexRegex = /^#([A-Fa-f0-9]{3}){1,2}$/;
  const floatRgbRegex =
    /^\{\s*r:\s*[\d\.]+,\s*g:\s*[\d\.]+,\s*b:\s*[\d\.]+(,\s*opacity:\s*[\d\.]+)?\s*\}$/;

  if (rgbRegex.test(color)) {
    const [, r, g, b] = color.match(rgbRegex);
    return { r: parseInt(r) / 255, g: parseInt(g) / 255, b: parseInt(b) / 255 };
  } else if (rgbaRegex.test(color)) {
    const [, r, g, b, a] = color.match(rgbaRegex);
    return {
      r: parseInt(r) / 255,
      g: parseInt(g) / 255,
      b: parseInt(b) / 255,
      a: parseFloat(a),
    };
  } else if (hslRegex.test(color)) {
    const [, h, s, l] = color.match(hslRegex);
    return hslToRgbFloat(parseInt(h), parseInt(s) / 100, parseInt(l) / 100);
  } else if (hslaRegex.test(color)) {
    const [, h, s, l, a] = color.match(hslaRegex);
    return Object.assign(
      hslToRgbFloat(parseInt(h), parseInt(s) / 100, parseInt(l) / 100),
      { a: parseFloat(a) }
    );
  } else if (hexRegex.test(color)) {
    const hexValue = color.substring(1);
    const expandedHex =
      hexValue.length === 3
        ? hexValue
            .split("")
            .map((char) => char + char)
            .join("")
        : hexValue;
    return {
      r: parseInt(expandedHex.slice(0, 2), 16) / 255,
      g: parseInt(expandedHex.slice(2, 4), 16) / 255,
      b: parseInt(expandedHex.slice(4, 6), 16) / 255,
    };
  } else if (floatRgbRegex.test(color)) {
    return JSON.parse(color);
  } else {
    throw new Error("Invalid color format");
  }
}
