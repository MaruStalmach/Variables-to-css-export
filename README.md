Variable parsing as follows:
- **Numerical variables:** All numerical variables are assigned the "px" suffix
- **Exemptions from "px" suffix:** Variables containing the terms "bold", "regular", "weight", or "visibility" will not have the "px" suffix applied
- **Case sensitivity:** Variable names are case-sensitive and will remain unchanged, adhering to variable naming convention
- **Exclusion criteria:** Any variable containing "ux" in its name will be excluded from the export process
- **Font family name handling:** Variables that define font family names are exported with whitespace preserved, while all other string variables are exported without quotation marks
