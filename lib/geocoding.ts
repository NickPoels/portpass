/**
 * Geocoding utility for terminal location lookup using OpenStreetMap Nominatim API
 * Includes rate limiting to respect API constraints (1 request/second)
 */

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 second in milliseconds

/**
 * Geocode a terminal location using Nominatim API
 * @param terminalName - Name of the terminal
 * @param portName - Name of the port
 * @param country - Country name
 * @param address - Optional address or location description (takes priority if provided)
 * @returns Promise with coordinates or null if geocoding fails
 */
export async function geocodeTerminal(
    terminalName: string,
    portName: string,
    country: string,
    address?: string | null
): Promise<{ latitude: number; longitude: number } | null> {
    try {
        // Rate limiting: ensure at least 1 second between requests
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        
        if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
            const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        lastRequestTime = Date.now();

        // Construct query - prioritize address if available
        const query = address 
            ? `${address}, ${portName}, ${country}`
            : `${terminalName}, ${portName}, ${country}`;

        // Query Nominatim API
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
            {
                headers: {
                    'User-Agent': 'PortPass Terminal Geocoding'
                }
            }
        );

        if (!response.ok) {
            console.warn(`Geocoding API error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
            console.warn(`No geocoding results found for: ${query}`);
            return null;
        }

        const result = data[0];
        const latitude = parseFloat(result.lat);
        const longitude = parseFloat(result.lon);

        // Validate coordinates
        if (isNaN(latitude) || isNaN(longitude)) {
            console.warn(`Invalid coordinates in geocoding response: ${result.lat}, ${result.lon}`);
            return null;
        }

        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            console.warn(`Coordinates out of valid range: ${latitude}, ${longitude}`);
            return null;
        }

        return { latitude, longitude };
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
}

/**
 * Geocode a port location using Nominatim API
 * @param portName - Name of the port
 * @param country - Country name
 * @returns Promise with coordinates or null if geocoding fails
 */
export async function geocodePort(
    portName: string,
    country: string
): Promise<{ latitude: number; longitude: number } | null> {
    try {
        // Rate limiting: ensure at least 1 second between requests
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        
        if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
            const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        lastRequestTime = Date.now();

        // Construct query
        const query = `${portName} port, ${country}`;

        // Query Nominatim API
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
            {
                headers: {
                    'User-Agent': 'PortPass Port Geocoding'
                }
            }
        );

        if (!response.ok) {
            console.warn(`Geocoding API error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
            console.warn(`No geocoding results found for: ${query}`);
            return null;
        }

        const result = data[0];
        const latitude = parseFloat(result.lat);
        const longitude = parseFloat(result.lon);

        // Validate coordinates
        if (isNaN(latitude) || isNaN(longitude)) {
            console.warn(`Invalid coordinates in geocoding response: ${result.lat}, ${result.lon}`);
            return null;
        }

        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            console.warn(`Coordinates out of valid range: ${latitude}, ${longitude}`);
            return null;
        }

        return { latitude, longitude };
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
}



