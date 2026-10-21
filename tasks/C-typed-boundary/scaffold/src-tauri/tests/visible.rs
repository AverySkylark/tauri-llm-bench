mod common;

use bench_task::{register, Coordinates, Habitat, Site, Survey};
use serde_json::json;

#[test]
fn get_site_uses_camel_case_arguments() {
    let survey = Survey {
        sites: vec![Site {
            id: 7,
            name: "North marsh".into(),
            habitat: Habitat::Wetland,
            coordinates: Coordinates { lat: 52.1, lon: 4.3 },
            active: true,
        }],
        ..Default::default()
    };
    let (_app, w) = common::mock_app(|b| register(b, survey));
    assert_eq!(
        common::invoke(&w, "get_site", json!({ "siteId": 7 })),
        Ok(json!({ "id": 7, "name": "North marsh", "habitat": "wetland", "coordinates": { "lat": 52.1, "lon": 4.3 }, "active": true }))
    );
    assert!(common::invoke(&w, "get_site", json!({ "site_id": 7 })).is_err(), "snake_case keys are rejected");
}
