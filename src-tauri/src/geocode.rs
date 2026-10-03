// Place search via OpenStreetMap's Nominatim. This is the app's only network call besides the
// basemap tiles the user enabled, and it runs only when the user presses Enter in the search box.
// Per Nominatim's usage policy requests carry an identifying User-Agent and are spaced at least
// one second apart. The response parser is separate so it can be tested without a network.
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const ENDPOINT: &str = "https://nominatim.openstreetmap.org/search";
const USER_AGENT: &str = concat!(
    "Groundwork/",
    env!("CARGO_PKG_VERSION"),
    " (desktop geodata viewer)"
);
const MIN_INTERVAL: Duration = Duration::from_millis(1100);
const MAX_QUERY_CHARS: usize = 200;

#[derive(Debug, thiserror::Error)]
pub enum GeocodeError {
    #[error("Enter a place name to search for")]
    EmptyQuery,
    #[error("The search text is too long (limit {MAX_QUERY_CHARS} characters)")]
    TooLong,
    #[error("Could not reach the search service. Place search needs an internet connection ({0})")]
    Network(String),
    #[error("The search service returned something unexpected: {0}")]
    BadResponse(String),
}

impl Serialize for GeocodeError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    /// west, south, east, north when the service provides a bounding box.
    pub bbox: Option<[f64; 4]>,
}

#[derive(Deserialize)]
struct RawPlace {
    display_name: String,
    lat: String,
    lon: String,
    #[serde(default)]
    boundingbox: Vec<String>,
}

/// Parses a Nominatim `jsonv2` search response. Entries with unusable coordinates are skipped.
pub fn parse_response(json: &str) -> Result<Vec<Place>, GeocodeError> {
    let raw: Vec<RawPlace> =
        serde_json::from_str(json).map_err(|e| GeocodeError::BadResponse(e.to_string()))?;
    Ok(raw
        .into_iter()
        .filter_map(|p| {
            let lat: f64 = p.lat.parse().ok()?;
            let lon: f64 = p.lon.parse().ok()?;
            if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
                return None;
            }
            // Nominatim orders the box as [south, north, west, east].
            let bbox = match p
                .boundingbox
                .iter()
                .map(|v| v.parse::<f64>())
                .collect::<Result<Vec<_>, _>>()
            {
                Ok(b) if b.len() == 4 => Some([b[2], b[0], b[3], b[1]]),
                _ => None,
            };
            Some(Place {
                name: p.display_name,
                lat,
                lon,
                bbox,
            })
        })
        .collect())
}

static LAST_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);

/// Blocks as needed so requests are at least `MIN_INTERVAL` apart.
fn wait_for_turn() {
    let mut last = LAST_REQUEST.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(t) = *last {
        let since = t.elapsed();
        if since < MIN_INTERVAL {
            std::thread::sleep(MIN_INTERVAL - since);
        }
    }
    *last = Some(Instant::now());
}

pub fn search(query: &str) -> Result<Vec<Place>, GeocodeError> {
    let q = query.trim();
    if q.is_empty() {
        return Err(GeocodeError::EmptyQuery);
    }
    if q.chars().count() > MAX_QUERY_CHARS {
        return Err(GeocodeError::TooLong);
    }
    wait_for_turn();
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .into();
    let mut response = agent
        .get(ENDPOINT)
        .header("User-Agent", USER_AGENT)
        .query("format", "jsonv2")
        .query("limit", "6")
        .query("q", q)
        .call()
        .map_err(|e| GeocodeError::Network(e.to_string()))?;
    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|e| GeocodeError::Network(e.to_string()))?;
    parse_response(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_places_and_reorders_the_bounding_box() {
        let json = r#"[
          {"display_name":"Paris, France","lat":"48.8588897","lon":"2.3200410","boundingbox":["48.8155755","48.9021560","2.2241220","2.4697602"]},
          {"display_name":"No box","lat":"10","lon":"-20"},
          {"display_name":"Bad lat","lat":"abc","lon":"1"},
          {"display_name":"Out of range","lat":"95","lon":"1"}
        ]"#;
        let places = parse_response(json).unwrap();
        assert_eq!(places.len(), 2);
        assert_eq!(places[0].name, "Paris, France");
        assert_eq!(
            places[0].bbox,
            Some([2.2241220, 48.8155755, 2.4697602, 48.9021560])
        );
        assert_eq!(places[1].bbox, None);
        assert_eq!((places[1].lat, places[1].lon), (10.0, -20.0));
    }

    #[test]
    fn empty_results_and_garbage() {
        assert!(parse_response("[]").unwrap().is_empty());
        assert!(matches!(
            parse_response("<html>"),
            Err(GeocodeError::BadResponse(_))
        ));
        assert!(matches!(
            parse_response("{\"error\":\"x\"}"),
            Err(GeocodeError::BadResponse(_))
        ));
    }

    #[test]
    fn rejects_empty_and_oversized_queries_without_touching_the_network() {
        assert!(matches!(search("   "), Err(GeocodeError::EmptyQuery)));
        assert!(matches!(
            search(&"x".repeat(201)),
            Err(GeocodeError::TooLong)
        ));
    }

    #[test]
    fn user_agent_identifies_the_app() {
        assert!(USER_AGENT.starts_with("Groundwork/"));
    }
}
