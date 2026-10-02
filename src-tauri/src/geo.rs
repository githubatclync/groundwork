// Small geodesy helpers for feature details: great-circle length and spherical polygon area.
// These are spherical approximations (good to ~0.5%); the measurement tools in M4 use
// GeographicLib for ellipsoidal accuracy.
const EARTH_RADIUS_M: f64 = 6_371_008.8;

pub fn haversine_m(lon1: f64, lat1: f64, lon2: f64, lat2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dp = p2 - p1;
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * a.sqrt().asin()
}

/// Length in meters of a path given as lon, lat, alt triples.
pub fn path_length_m(coords: &[f64]) -> f64 {
    coords
        .chunks_exact(3)
        .zip(coords.chunks_exact(3).skip(1))
        .map(|(a, b)| haversine_m(a[0], a[1], b[0], b[1]))
        .sum()
}

/// Area in square meters of a ring given as lon, lat, alt triples (closed or not).
pub fn ring_area_m2(coords: &[f64]) -> f64 {
    let n = coords.len() / 3;
    if n < 3 {
        return 0.0;
    }
    let mut sum = 0.0;
    for i in 0..n {
        let a = &coords[i * 3..i * 3 + 2];
        let b = &coords[((i + 1) % n) * 3..((i + 1) % n) * 3 + 2];
        let mut dl = (b[0] - a[0]).to_radians();
        // Take the short way across the antimeridian.
        if dl > std::f64::consts::PI {
            dl -= 2.0 * std::f64::consts::PI;
        } else if dl < -std::f64::consts::PI {
            dl += 2.0 * std::f64::consts::PI;
        }
        sum += dl * (2.0 + a[1].to_radians().sin() + b[1].to_radians().sin());
    }
    (sum * EARTH_RADIUS_M * EARTH_RADIUS_M / 2.0).abs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haversine_one_degree_of_latitude() {
        let d = haversine_m(0.0, 0.0, 0.0, 1.0);
        assert!((d - 111_195.0).abs() < 100.0, "{d}");
    }

    #[test]
    fn path_length_adds_segments() {
        let p = [0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0];
        assert!((path_length_m(&p) - 222_390.0).abs() < 200.0);
        assert_eq!(path_length_m(&[0.0, 0.0, 0.0]), 0.0);
    }

    #[test]
    fn one_degree_square_at_equator() {
        // ~111.19 km x 111.19 km = ~12,364 km2
        let sq = [
            0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0,
        ];
        let a = ring_area_m2(&sq) / 1e6;
        assert!((a - 12_364.0).abs() < 60.0, "{a}");
        // Winding direction does not matter.
        let rev = [0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.0];
        assert!((ring_area_m2(&rev) / 1e6 - a).abs() < 1.0);
    }

    #[test]
    fn area_shrinks_with_latitude() {
        let at = |lat: f64| {
            ring_area_m2(&[
                0.0,
                lat,
                0.0,
                1.0,
                lat,
                0.0,
                1.0,
                lat + 1.0,
                0.0,
                0.0,
                lat + 1.0,
                0.0,
            ])
        };
        assert!(at(60.0) < at(0.0) * 0.6);
    }

    #[test]
    fn area_across_the_antimeridian() {
        let sq = [
            179.5, 0.0, 0.0, -179.5, 0.0, 0.0, -179.5, 1.0, 0.0, 179.5, 1.0, 0.0,
        ];
        assert!((ring_area_m2(&sq) / 1e6 - 12_364.0).abs() < 60.0);
    }
}
