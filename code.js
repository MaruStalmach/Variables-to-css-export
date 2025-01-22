console.clear();

/**
 * Create a collection with the given name
 * @param {string} name 
 * @returns collection and modeId (id of the default mode in the collection)
 */
function createCollection(name) {
    const collection = figma.variables.createVariableCollection(name);
    const modeId = collection.modes[0].modeId;
    return { collection, modeId };
}

/*
* Create a token with the given name and value
*/
function createToken(collection, modeId, type, name, value) {
    const token = figma.variables.createVariable(name, collection, type);
    token.setValueForMode(modeId, value);
    return token;
}

/*
 * Create a variable that acts as an alias to another existing variable
 */
function createVariable(collection, modeId, key, valueKey, tokens) {
    const token = tokens[valueKey];
    return createToken(collection, modeId, token.resolvedType, key, {
        type: "VARIABLE_ALIAS",
        id: `${token.id}`,
    });
}

/**
 * Import JSON file and create tokens, organizing them in a collection and roslving aliases
 */
function importJSONFile({ fileName, body }) {
    const json = JSON.parse(body);
    const { collection, modeId } = createCollection(fileName);
    const aliases = {};
    const tokens = {};
    Object.entries(json).forEach(([key, object]) => {
        traverseToken({
            collection,
            modeId,
            type: json.$type,
            key,
            object,
            tokens,
            aliases,
        });
    });
    processAliases({ collection, modeId, aliases, tokens });
}

/**
 * 
 */
function processAliases({ collection, modeId, aliases, tokens }) {
    aliases = Object.values(aliases); //cast onto array
    let generations = aliases.length;
    while (aliases.length && generations > 0) {
        for (let i = 0; i < aliases.length; i++) {
            const { key, type, valueKey } = aliases[i];
            const token = tokens[valueKey];
            if (token) {
                aliases.splice(i, 1);
                tokens[key] = createVariable(collection, modeId, key, valueKey, tokens); //create variable
            }
        }
        generations--;
    }
}

/**
 * Determines if a value is an alias by checking if it starts with "{"
 * @param {string} value 
 * @returns raw value of a variable
 */
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

/**
 * Fetches available skins collections and passes it into the UI
 */
async function initializeExportUI() {
    try {
        const collections = await figma.variables.getLocalVariableCollectionsAsync();
        if (collections && collections.length > 0) {
            const skins = collections[0].modes.map(mode => mode.name);
            console.log("Available skins:", skins);
            figma.ui.postMessage({ 
                type: "AVAILABLE_SKINS", 
                skins: skins 
            });
        } else {
            console.error("No collections found");
            figma.ui.postMessage({ 
                type: "AVAILABLE_SKINS", 
                skins: [] 
            });
        }
    } catch (error) {
        console.error("Error getting skins:", error);
        figma.ui.postMessage({ 
            type: "ERROR", 
            message: "Failed to load skins" 
        });
    }
}

/**
 * Creates a CSS file to download with the variables from the selected skins.
 * Applies the following changes:
 * 1. strips px suffix from variables containing "visibility", "bold", "regular" or "weight" in the name
 * 2. skips variables containing "ux" in the name
 * 3.
 * 
 * @param selectedSkins selected checkboxes 
 * @returns donloadable CSS file with the variables from the selected skins
 */
async function exportToCSS(selectedSkins = []) {
    //fetch all collections
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    let forExport = {};

    //helper function to get the final value, handling both direct values and objects
    function getProcessedValue(value, name, resolvedType) {
        //if not Object or null
        if (!value || typeof value !== 'object') {
            return value;
        }
       
        if (value.type === "VARIABLE_ALIAS") {
            return value; //return alias
        }
    
        if ('r' in value && 'g' in value && 'b' in value) {
            return rgbToHex(value);
        }

        //handle font objects for sub-properties 
        if (value.family || value.fontFamily || value.style) {
            let fontProps = [];
            if (value.family) fontProps.push(`"${value.family}"`);
            if (value.fontFamily) fontProps.push(`"${value.fontFamily}"`);
            if (value.style) fontProps.push(value.style);
            if (value.fontSize) fontProps.push(`${value.fontSize}px`);
            return fontProps.join(' ');
        }
        if (Object.keys(value).length === 1) {
            const singleValue = Object.values(value)[0];
            return typeof singleValue === 'number' ? `${singleValue}px` : singleValue;
        }

        if (value.value !== undefined) return value.value;
        if (value.default !== undefined) return value.default;

        //stringify for unhandled objects
        console.warn('Unhandled object value for:', name, value);
        return JSON.stringify(value);
    }

    if (!collections || collections.length === 0) {
        console.error("No collections found");
        return;
    }

    for (const collection of collections) {
        const { modes, variableIds } = collection;

        if (!variableIds || !Array.isArray(variableIds)) {
            console.error(`Expected an array for variableIds, but got ${typeof variableIds} in collection: ${collection.name}`);
            continue;
        }

        for (const mode of modes) {
            if (selectedSkins.length > 0 && !selectedSkins.includes(mode.name)) {
                continue;
            }

            let cssVariables = '';
            let processedVars = new Set();
            
            for (const variableId of variableIds) {
                try {
                    const variable = await figma.variables.getVariableByIdAsync(variableId);
                    if (!variable) continue;

                    const { name, resolvedType, valuesByMode } = variable;
                    
                    if (name.toLowerCase().includes('ux')) {
                        continue;
                    }

                    const value = valuesByMode ? valuesByMode[mode.modeId] : undefined;

                    if (value !== undefined) {
                        const varName = `--${name.replace(/\//g, '-').replace(/\s+/g, '-')}`;

                        if (processedVars.has(varName)) {
                            continue;
                        }
                        processedVars.add(varName);

                        let cssValue;
                        if (value.type === "VARIABLE_ALIAS") {
                            const currentVar = await figma.variables.getVariableByIdAsync(value.id);
                            
                            if (currentVar.name.toLowerCase().includes('ux')) {
                                continue;
                            }
                            cssValue = `var(--${currentVar.name.replace(/\//g, '-').replace(/\s+/g, '-')})`;
                        } else {
                            cssValue = getProcessedValue(value, name, resolvedType);
                            if (typeof cssValue === 'number' && !name.toLowerCase().match(/weight|bold|regular|visibility/i)) {
                                cssValue = `${cssValue}px`;
                            }
                        }

                        cssVariables += `    ${varName}: ${cssValue};\n`;
                    }

                    //process parent variable
                    const pathParts = name.split('/');
                    if (pathParts.length > 1) {
                        const parentPath = pathParts.slice(0, -1).join('/');
                        const parentVarName = `--${parentPath.replace(/\//g, '-').replace(/\s+/g, '-')}`;
                        
                        if (!processedVars.has(parentVarName)) {
                            processedVars.add(parentVarName);
                            const parentVar = variableIds.find(async (id) => {
                                const v = await figma.variables.getVariableByIdAsync(id);
                                return v && v.name === parentPath;
                            });
                            if (parentVar) {
                                const pVar = await figma.variables.getVariableByIdAsync(parentVar);
                                if (pVar && pVar.valuesByMode && pVar.valuesByMode[mode.modeId] !== undefined) {
                                    const pValue = getProcessedValue(pVar.valuesByMode[mode.modeId], parentPath, pVar.resolvedType);
                                    cssVariables += `    ${parentVarName}: ${pValue};\n`;
                                }
                            }
                        }
                    }

                } catch (error) {
                    console.error("Error processing variable:", variableId, error);
                }
            }

            if (cssVariables) {
                const modeName = mode.name.toLowerCase().replace(/\s+/g, '-');
                forExport[modeName] = `:root {\n${cssVariables}}\n`;
            }
        }
    }

    const files = Object.entries(forExport).map(([modeName, cssContent]) => ({
        fileName: `variables-${modeName}.css`,
        body: cssContent
    }));

    figma.ui.postMessage({ type: "EXPORT_RESULT", files });
}

/**
 * Converts an RGB to HEX 
 */
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

/**
 * Converts HSL to RGB
 */
function hslToRgbFloat(h, s, l) {
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    if (s === 0) {
        return { r: l, g: l, b: l };
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = hue2rgb(p, q, (h + 1 / 3) % 1);
    const g = hue2rgb(p, q, h % 1);
    const b = hue2rgb(p, q, (h - 1 / 3) % 1);

    return { r, g, b };
}

figma.ui.onmessage = async (e) => {
    if (e.type === "EXPORT") {
        await exportToCSS(e.skins);
    } else if (e.type === "GET_SKINS") {
        await initializeExportUI();
    }
};

if (figma.command === "export") {
    figma.showUI(__uiFiles__["export"], {
        width: 500,
        height: 500,
        themeColors: true,
    });
    initializeExportUI();
}