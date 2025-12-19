import { ISPSRiskLevel, ISPSEnforcementStrength, CargoType } from './types';

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    correctedValue?: any;
    suggestions?: string[];
}

/**
 * Validate port authority name
 */
export function validatePortAuthority(name: string | null | undefined): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!name || name.trim() === '') {
        return { isValid: false, errors: ['Port authority name is required'], warnings: [] };
    }
    
    const trimmed = name.trim();
    
    // Length validation
    if (trimmed.length < 3) {
        errors.push('Port authority name is too short (minimum 3 characters)');
    }
    if (trimmed.length > 200) {
        warnings.push('Port authority name is very long (over 200 characters)');
    }
    
    // Format validation - should not be just numbers or special characters
    if (/^[\d\s\-_]+$/.test(trimmed)) {
        warnings.push('Port authority name appears to be only numbers or special characters');
    }
    
    // Common patterns
    const hasAuthorityKeyword = /authority|port|harbor|harbour|maritime/i.test(trimmed);
    if (!hasAuthorityKeyword) {
        warnings.push('Port authority name does not contain common keywords (authority, port, harbor, maritime)');
    }
    
    // Check for suspicious patterns
    if (trimmed.toLowerCase() === 'unknown' || trimmed.toLowerCase() === 'n/a' || trimmed.toLowerCase() === 'none') {
        warnings.push('Port authority name appears to be a placeholder value');
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        correctedValue: errors.length === 0 ? trimmed : undefined
    };
}

/**
 * Validate ISPS risk level
 */
export function validateISPSLevel(level: string | null | undefined): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];
    
    if (!level) {
        return { isValid: true, errors: [], warnings: [], correctedValue: null };
    }
    
    const validLevels: ISPSRiskLevel[] = ['Low', 'Medium', 'High', 'Very High'];
    const levelNormalized = level.trim();
    
    // Exact match
    if (validLevels.includes(levelNormalized as ISPSRiskLevel)) {
        return { isValid: true, errors: [], warnings: [], correctedValue: levelNormalized };
    }
    
    // Try to match with case-insensitive
    const levelLower = levelNormalized.toLowerCase();
    const matchedLevel = validLevels.find(l => l.toLowerCase() === levelLower);
    if (matchedLevel) {
        warnings.push(`ISPS level case corrected: "${levelNormalized}" -> "${matchedLevel}"`);
        return { isValid: true, errors: [], warnings, correctedValue: matchedLevel };
    }
    
    // Try fuzzy matching
    if (levelLower.includes('low') && !levelLower.includes('high')) {
        suggestions.push('Low');
    } else if (levelLower.includes('medium') || levelLower.includes('moderate')) {
        suggestions.push('Medium');
    } else if (levelLower.includes('high') && !levelLower.includes('very')) {
        suggestions.push('High');
    } else if (levelLower.includes('very') && levelLower.includes('high')) {
        suggestions.push('Very High');
    }
    
    if (suggestions.length > 0) {
        errors.push(`Invalid ISPS level: "${levelNormalized}". Did you mean "${suggestions[0]}"?`);
        return { isValid: false, errors, warnings, suggestions, correctedValue: suggestions[0] as ISPSRiskLevel };
    }
    
    errors.push(`Invalid ISPS level: "${levelNormalized}". Must be one of: ${validLevels.join(', ')}`);
    return { isValid: false, errors, warnings, suggestions: validLevels };
}

/**
 * Validate ISPS enforcement strength
 */
export function validateEnforcementStrength(strength: string | null | undefined): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];
    
    if (!strength) {
        return { isValid: true, errors: [], warnings: [], correctedValue: null };
    }
    
    const validStrengths: ISPSEnforcementStrength[] = ['Weak', 'Moderate', 'Strong', 'Very Strong'];
    const strengthNormalized = strength.trim();
    
    // Exact match
    if (validStrengths.includes(strengthNormalized as ISPSEnforcementStrength)) {
        return { isValid: true, errors: [], warnings: [], correctedValue: strengthNormalized };
    }
    
    // Try to match with case-insensitive
    const strengthLower = strengthNormalized.toLowerCase();
    const matchedStrength = validStrengths.find(s => s.toLowerCase() === strengthLower);
    if (matchedStrength) {
        warnings.push(`Enforcement strength case corrected: "${strengthNormalized}" -> "${matchedStrength}"`);
        return { isValid: true, errors: [], warnings, correctedValue: matchedStrength };
    }
    
    // Try fuzzy matching
    if (strengthLower.includes('weak')) {
        suggestions.push('Weak');
    } else if (strengthLower.includes('moderate') || strengthLower.includes('medium')) {
        suggestions.push('Moderate');
    } else if (strengthLower.includes('strong') && !strengthLower.includes('very')) {
        suggestions.push('Strong');
    } else if (strengthLower.includes('very') && strengthLower.includes('strong')) {
        suggestions.push('Very Strong');
    }
    
    if (suggestions.length > 0) {
        errors.push(`Invalid enforcement strength: "${strengthNormalized}". Did you mean "${suggestions[0]}"?`);
        return { isValid: false, errors, warnings, suggestions, correctedValue: suggestions[0] as ISPSEnforcementStrength };
    }
    
    errors.push(`Invalid enforcement strength: "${strengthNormalized}". Must be one of: ${validStrengths.join(', ')}`);
    return { isValid: false, errors, warnings, suggestions: validStrengths };
}

/**
 * Validate identity competitors array
 */
export function validateIdentityCompetitors(competitors: string[] | null | undefined): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!competitors || competitors.length === 0) {
        return { isValid: true, errors: [], warnings: [], correctedValue: null };
    }
    
    if (!Array.isArray(competitors)) {
        errors.push('Identity competitors must be an array');
        return { isValid: false, errors, warnings: [] };
    }
    
    // Deduplicate and clean
    const cleaned: string[] = [];
    const seen = new Set<string>();
    
    for (const competitor of competitors) {
        if (!competitor || typeof competitor !== 'string') {
            warnings.push(`Invalid competitor entry: ${JSON.stringify(competitor)}`);
            continue;
        }
        
        const trimmed = competitor.trim();
        if (trimmed === '') {
            continue;
        }
        
        const normalized = trimmed.toLowerCase();
        if (!seen.has(normalized)) {
            seen.add(normalized);
            cleaned.push(trimmed);
        } else {
            warnings.push(`Duplicate competitor removed: "${trimmed}"`);
        }
    }
    
    // Validate each competitor name
    for (const competitor of cleaned) {
        if (competitor.length < 2) {
            warnings.push(`Competitor name is very short: "${competitor}"`);
        }
        if (competitor.length > 100) {
            warnings.push(`Competitor name is very long: "${competitor}"`);
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        correctedValue: cleaned.length > 0 ? cleaned : null
    };
}

/**
 * Validate identity adoption rate
 */
export function validateIdentityAdoptionRate(rate: string | null | undefined): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!rate) {
        return { isValid: true, errors: [], warnings: [], correctedValue: null };
    }
    
    const trimmed = rate.trim();
    
    // Check for percentage format
    const percentageMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*%?$/);
    if (percentageMatch) {
        const percentage = parseFloat(percentageMatch[1]);
        if (percentage < 0 || percentage > 100) {
            errors.push(`Percentage must be between 0 and 100, got: ${percentage}`);
            return { isValid: false, errors, warnings: [] };
        }
        return { isValid: true, errors: [], warnings: [], correctedValue: `${percentage}%` };
    }
    
    // Check for text format (High, Medium, Low, None)
    const textFormats = ['High', 'Medium', 'Low', 'None'];
    const rateLower = trimmed.toLowerCase();
    const matched = textFormats.find(f => f.toLowerCase() === rateLower);
    if (matched) {
        return { isValid: true, errors: [], warnings: [], correctedValue: matched };
    }
    
    // Try fuzzy matching
    if (rateLower.includes('high')) {
        warnings.push(`Adoption rate normalized: "${trimmed}" -> "High"`);
        return { isValid: true, errors: [], warnings, correctedValue: 'High' };
    } else if (rateLower.includes('medium') || rateLower.includes('moderate')) {
        warnings.push(`Adoption rate normalized: "${trimmed}" -> "Medium"`);
        return { isValid: true, errors: [], warnings, correctedValue: 'Medium' };
    } else if (rateLower.includes('low')) {
        warnings.push(`Adoption rate normalized: "${trimmed}" -> "Low"`);
        return { isValid: true, errors: [], warnings, correctedValue: 'Low' };
    } else if (rateLower.includes('none') || rateLower.includes('no')) {
        warnings.push(`Adoption rate normalized: "${trimmed}" -> "None"`);
        return { isValid: true, errors: [], warnings, correctedValue: 'None' };
    }
    
    warnings.push(`Adoption rate format unclear: "${trimmed}". Expected percentage (e.g., "50%") or text (High/Medium/Low/None)`);
    return { isValid: true, errors: [], warnings, correctedValue: trimmed };
}

/**
 * Validate coordinates
 */
export function validateCoordinates(lat: number | null | undefined, lon: number | null | undefined): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (lat === null || lat === undefined || lon === null || lon === undefined) {
        return { isValid: true, errors: [], warnings: [], correctedValue: null };
    }
    
    if (typeof lat !== 'number' || typeof lon !== 'number') {
        errors.push('Latitude and longitude must be numbers');
        return { isValid: false, errors, warnings: [] };
    }
    
    if (isNaN(lat) || isNaN(lon)) {
        errors.push('Latitude and longitude cannot be NaN');
        return { isValid: false, errors, warnings: [] };
    }
    
    // Range validation
    if (lat < -90 || lat > 90) {
        errors.push(`Latitude must be between -90 and 90, got: ${lat}`);
    }
    if (lon < -180 || lon > 180) {
        errors.push(`Longitude must be between -180 and 180, got: ${lon}`);
    }
    
    // Precision validation
    const latRounded = Math.round(lat * 1000000) / 1000000;
    const lonRounded = Math.round(lon * 1000000) / 1000000;
    if (latRounded !== lat || lonRounded !== lon) {
        warnings.push(`Coordinates rounded to 6 decimal places for precision`);
    }
    
    // Check for suspicious values (0,0 is often a default/error value)
    if (lat === 0 && lon === 0) {
        warnings.push('Coordinates are (0, 0) which may be a default/error value');
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        correctedValue: errors.length === 0 ? { lat: latRounded, lon: lonRounded } : undefined
    };
}

/**
 * Validate operator group name
 */
export function validateOperatorGroup(name: string | null | undefined): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!name || name.trim() === '') {
        return { isValid: true, errors: [], warnings: [], correctedValue: null };
    }
    
    const trimmed = name.trim();
    
    // Length validation
    if (trimmed.length < 2) {
        errors.push('Operator group name is too short (minimum 2 characters)');
    }
    if (trimmed.length > 200) {
        warnings.push('Operator group name is very long (over 200 characters)');
    }
    
    // Format validation
    if (/^[\d\s\-_]+$/.test(trimmed)) {
        warnings.push('Operator group name appears to be only numbers or special characters');
    }
    
    // Check for suspicious patterns
    if (trimmed.toLowerCase() === 'unknown' || trimmed.toLowerCase() === 'n/a' || trimmed.toLowerCase() === 'none') {
        warnings.push('Operator group name appears to be a placeholder value');
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        correctedValue: errors.length === 0 ? trimmed : undefined
    };
}

/**
 * Validate capacity string
 */
export function validateCapacity(capacity: string | null | undefined): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!capacity || capacity.trim() === '') {
        return { isValid: true, errors: [], warnings: [], correctedValue: null };
    }
    
    const trimmed = capacity.trim();
    
    // Check for common capacity patterns
    const teuPattern = /(\d+(?:[.,]\d+)?)\s*(?:million\s*)?teu/i;
    const tonnagePattern = /(\d+(?:[.,]\d+)?)\s*(?:million\s*)?(?:tons?|tonnes?|mt)/i;
    const hasTeu = teuPattern.test(trimmed);
    const hasTonnage = tonnagePattern.test(trimmed);
    
    if (!hasTeu && !hasTonnage && !/^\d+/.test(trimmed)) {
        warnings.push(`Capacity format unclear: "${trimmed}". Expected format like "2.5 million TEU" or "10 million tons"`);
    }
    
    // Check for suspicious values
    if (trimmed.toLowerCase() === 'unknown' || trimmed.toLowerCase() === 'n/a') {
        warnings.push('Capacity appears to be a placeholder value');
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        correctedValue: errors.length === 0 ? trimmed : undefined
    };
}

/**
 * Validate cargo types array
 */
export function validateCargoTypes(types: string[] | null | undefined): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];
    
    if (!types || types.length === 0) {
        return { isValid: true, errors: [], warnings: [], correctedValue: [] };
    }
    
    if (!Array.isArray(types)) {
        errors.push('Cargo types must be an array');
        return { isValid: false, errors, warnings: [] };
    }
    
    const validTypes: CargoType[] = [
        'Container',
        'RoRo',
        'Dry Bulk',
        'Liquid Bulk',
        'Break Bulk',
        'Multipurpose',
        'Passenger/Ferry'
    ];
    
    const cleaned: CargoType[] = [];
    const seen = new Set<string>();
    
    for (const type of types) {
        if (!type || typeof type !== 'string') {
            warnings.push(`Invalid cargo type entry: ${JSON.stringify(type)}`);
            continue;
        }
        
        const trimmed = type.trim();
        if (trimmed === '') {
            continue;
        }
        
        // Exact match
        if (validTypes.includes(trimmed as CargoType)) {
            const normalized = trimmed.toLowerCase();
            if (!seen.has(normalized)) {
                seen.add(normalized);
                cleaned.push(trimmed as CargoType);
            }
            continue;
        }
        
        // Case-insensitive match
        const typeLower = trimmed.toLowerCase();
        const matched = validTypes.find(t => t.toLowerCase() === typeLower);
        if (matched) {
            const normalized = matched.toLowerCase();
            if (!seen.has(normalized)) {
                seen.add(normalized);
                cleaned.push(matched);
                warnings.push(`Cargo type case corrected: "${trimmed}" -> "${matched}"`);
            }
            continue;
        }
        
        // Fuzzy matching
        if (typeLower.includes('container')) {
            suggestions.push('Container');
        } else if (typeLower.includes('roro') || typeLower.includes('roll-on')) {
            suggestions.push('RoRo');
        } else if (typeLower.includes('dry') && typeLower.includes('bulk')) {
            suggestions.push('Dry Bulk');
        } else if (typeLower.includes('liquid') && typeLower.includes('bulk')) {
            suggestions.push('Liquid Bulk');
        } else if (typeLower.includes('break') && typeLower.includes('bulk')) {
            suggestions.push('Break Bulk');
        } else if (typeLower.includes('multipurpose') || typeLower.includes('multi-purpose')) {
            suggestions.push('Multipurpose');
        } else if (typeLower.includes('passenger') || typeLower.includes('ferry')) {
            suggestions.push('Passenger/Ferry');
        }
        
        if (suggestions.length > 0) {
            const suggestion = suggestions[suggestions.length - 1];
            warnings.push(`Cargo type "${trimmed}" not recognized. Did you mean "${suggestion}"?`);
            const normalized = suggestion.toLowerCase();
            if (!seen.has(normalized)) {
                seen.add(normalized);
                cleaned.push(suggestion);
            }
        } else {
            warnings.push(`Unknown cargo type: "${trimmed}". Valid types: ${validTypes.join(', ')}`);
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        correctedValue: cleaned,
        suggestions: suggestions.length > 0 ? [...new Set(suggestions)] : undefined
    };
}
