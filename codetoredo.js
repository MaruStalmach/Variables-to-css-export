// Helper functions
const isAlias = (value) => {
    if (!value || typeof value !== 'string') return false;
    return value.trim().charAt(0) === '{';
  };
  
  const parseAliasKey = (aliasValue) => {
    return aliasValue
      .trim()
      .replace(/\./g, '/')
      .replace(/[{}]/g, '');
  };
  
  const rgbToHex = (color) => {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  };
  
  class VariableProcessor {
    constructor() {
      this.aliasCache = new Map();
      this.processedVariables = new Map();
    }
  
    async resolveAlias(variable, modeId, collections) {
      const cacheKey = `${variable.id}-${modeId}`;
      if (this.aliasCache.has(cacheKey)) {
        return this.aliasCache.get(cacheKey);
      }
  
      try {
        const aliasId = variable.valuesByMode[modeId];
        if (!aliasId) throw new Error(`No value found for mode ${modeId}`);
  
        const referencedVariable = await figma.variables.getVariableByIdAsync(aliasId);
        if (!referencedVariable) throw new Error(`Referenced variable not found: ${aliasId}`);
  
        let resolvedValue;
        if (referencedVariable.resolvedType === 'VARIABLE_ALIAS') {
          resolvedValue = await this.resolveAlias(referencedVariable, modeId, collections);
        } else {
          resolvedValue = referencedVariable.valuesByMode[modeId];
        }
  
        this.aliasCache.set(cacheKey, resolvedValue);
        return resolvedValue;
      } catch (error) {
        console.error(`Error resolving alias for ${variable.name}:`, error);
        return null;
      }
    }
  
    async processVariable(variable, modeValue, collection) {
      if (this.processedVariables.has(variable.id)) {
        return this.processedVariables.get(variable.id);
      }
  
      const processedVariable = { ...variable };
      processedVariable.name = variable.name.replaceAll('/', '-');
  
      const shouldNotAddPx = /weight|bold|regular|visibility/i.test(variable.name);
      const modeId = Object.keys(variable.valuesByMode)[0];
      const value = variable.valuesByMode[modeId];
  
      try {
        switch (variable.resolvedType) {
          case 'FLOAT':
            processedVariable.value = await this.processFloatValue(value, shouldNotAddPx);
            break;
          case 'COLOR':
            processedVariable.value = await this.processColorValue(value);
            break;
          case 'VARIABLE_ALIAS':
            processedVariable.value = await this.resolveAlias(variable, modeId, collection);
            break;
          default:
            processedVariable.value = value;
        }
  
        this.processedVariables.set(variable.id, processedVariable);
        return processedVariable;
      } catch (error) {
        console.error(`Error processing variable ${variable.name}:`, error);
        return variable;
      }
    }
  
    async processFloatValue(value, shouldNotAddPx) {
      if (isAlias(value)) {
        return value; // Keep alias reference for now
      }
      
      const numericValue = parseFloat(value);
      if (isNaN(numericValue)) return value;
      
      return shouldNotAddPx ? numericValue : `${numericValue}px`;
    }
  
    async processColorValue(value) {
      if (isAlias(value)) {
        return value;
      }
  
      if (value && typeof value === 'object' && 'r' in value && 'g' in value && 'b' in value) {
        return rgbToHex(value);
      }
  
      return value;
    }
  }
  
  // Main plugin code
  figma.ui.onmessage = async (message) => {
    if (message.type === 'EXPORT') {
      try {
        const collections = await figma.variables.getLocalVariableCollectionsAsync();
        const variableProcessor = new VariableProcessor();
        const fileStructure = {};
  
        for (const collection of collections) {
          const { name, modes, variableIds } = collection;
          
          fileStructure[name] = {};
          
          for (const mode of modes) {
            const modeDict = {};
            
            for (const variableId of variableIds) {
              try {
                const variable = await figma.variables.getVariableByIdAsync(variableId);
                if (!variable) continue;
  
                const processedVariable = await variableProcessor.processVariable(
                  variable,
                  variable.valuesByMode[mode.modeId],
                  collection
                );
  
                modeDict[processedVariable.name] = {
                  type: processedVariable.resolvedType,
                  value: processedVariable.value
                };
              } catch (err) {
                console.error(`Failed to process variable: ${variableId}`, err);
              }
            }
            
            fileStructure[name][mode.name] = modeDict;
          }
        }
  
        figma.ui.postMessage({ type: 'EXPORT_RESULT', data: fileStructure });
      } catch (err) {
        console.error('Export error:', err);
        figma.ui.postMessage({ type: 'EXPORT_ERROR', error: err.message });
      }
    }
  };
  
  if (figma.command === 'export') {
    figma.showUI(__uiFiles__['export'], {
      width: 500,
      height: 500,
      themeColors: true,
    });
  }