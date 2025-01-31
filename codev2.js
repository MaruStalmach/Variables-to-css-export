async function fetchAndLogFigmaVariables() {
    try {
        // Get all local variable collections
        const collections = await figma.variables.getLocalVariableCollectionsAsync();
        console.log(`Total collections found: ${collections.length}`);

        // Iterate through each collection
        for (let i = 0; i < collections.length; i++) {
            const collection = collections[i];

            // Get full collection content
            const collectionContent = await figma.variables.getVariableCollectionByIdAsync(collection.id);

            console.log(`\n📦 Collection: ${collectionContent.name}`);
            console.log(`  Collection ID: ${collection.id}`);

            // Detailed logging of collection properties
            console.log('  Collection Properties:');
            console.log('  ' + JSON.stringify(collection, null, 2));

            // Call the listVariablesInModes function to log modes and their variables
            listVariablesInModes(collectionContent);
        }
    } catch (error) {
        console.error("Error fetching Figma variables:", error);
        console.error("Error details:", {
            message: error.message,
            stack: error.stack,
        });
    }
}

// Helper function to list all variables in each mode
function listVariablesInModes(collectionContent) {
    if (collectionContent.modes && collectionContent.modes.length > 0) {
        console.log('📂 Modes in Collection:');

        // Iterate through each mode in the collection
        collectionContent.modes.forEach((mode) => {
            console.log(`  📍 Mode: ${mode.name} (ID: ${mode.modeId})`);

            // Check if variables exist in the collection
            const variables = collectionContent.variables || {};
            if (Object.keys(variables).length > 0) {
                console.log('    🔗 Variables:');

                // Recursively process nested variables
                traverseVariables(variables, (variableName, modeId, value) => {
                    console.log(`      🔹 ${variableName}: ${JSON.stringify(value)} (Mode: ${modeId})`);
                }, mode.modeId);
            } else {
                console.log('    ⚠️ No variables found in this collection.');
            }
        });
    } else {
        console.log('⚠️ No modes found in this collection.');
    }
}

// Recursive function to traverse variables and resolve their values
function traverseVariables(variables, callback, modeId, prefix = '') {
    for (const key in variables) {
        const variable = variables[key];

        if (variable.type === 'VARIABLE') {
            // Resolve the variable value for the specific mode
            try {
                const resolvedValue = figma.variables.resolveVariableById(variable.id, modeId);
                callback(prefix + key, modeId, resolvedValue);
            } catch (error) {
                console.log(`        Unable to resolve value for variable "${prefix + key}": ${error.message}`);
            }
        } else if (variable.type === 'GROUP') {
            // If it's a group, recursively traverse its children
            traverseVariables(variable.children, callback, modeId, `${prefix}${key}/`);
        }
    }
}

// Execute the function
fetchAndLogFigmaVariables();
