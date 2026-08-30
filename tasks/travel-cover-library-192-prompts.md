# Travel cover library prompt matrix

Status: locked for generation

This matrix fixes every new catalog id before generation. It is the inventory checkpoint for the
48-to-192 expansion in `tasks/travel-cover-library-192.md`.

## Shared generation recipe — prompt version 2

Create one premium editorial travel photograph per row, in a photorealistic-natural style and a
4:3 landscape composition. Keep the principal subject in the middle or upper area, preserve a
quiet lower third for a title gradient, and leave enough environmental context to communicate the
travel mood. Destination scenes are broad visual interpretations, never evidence of a particular
hotel, restaurant, attraction, flight, or POI.

Every prompt prohibits readable text, letters used as decoration, logos, watermarks, UI, labelled
flags, copied artwork, close identifiable faces, distorted anatomy, duplicated objects, impossible
reflections, warped architecture or vehicles, and pseudo-signage. Generic scenes must remain
location-neutral. Generate one independent original per id; do not derive multiple catalog assets
from a composite or a single master.

Runtime exports are 960×720 sRGB progressive JPEGs, stripped of metadata. The desired focal point
is a starting value for catalog crop QA, not a substitute for inspecting the generated image.

## Batch A — Asia and Oceania

| Id | Kind / coverage | Scene and composition | Conditions | Focal |
| --- | --- | --- | --- | --- |
| beijing-hutong-dawn | Destination / East Asia | Quiet hutong roofs and courtyard lane, broad environmental view | Spring dawn, soft warm haze | 50% 44% |
| hong-kong-harbour-rain | Destination / East Asia | Layered harbour city seen across wet railings, no named landmark emphasis | Summer rain, blue hour | 54% 40% |
| taipei-teahouse-lane | Destination / East Asia | Intimate hillside teahouse lane with plants and masonry | Autumn overcast afternoon | 48% 43% |
| osaka-canal-evening | Destination / East Asia | Canal-side urban evening with bridges and reflections, no readable signs | Humid dusk, warm practical light | 50% 41% |
| hokkaido-flower-fields | Destination / East Asia | Rolling flower fields and distant rural hills | Clear summer morning | 52% 42% |
| jeju-volcanic-coast | Destination / East Asia | Black volcanic shoreline, grasses, and open sea | Breezy spring afternoon | 52% 41% |
| guilin-karst-river | Destination / East Asia | River bend framed by layered karst hills and one small boat | Misty spring morning | 50% 39% |
| chengdu-teahouse-garden | Destination / East Asia | Leafy open-air teahouse garden with empty tables | Summer shade, late morning | 50% 46% |
| hanoi-old-quarter | Destination / Southeast Asia | Narrow old-quarter street, balconies and scooters as background texture | Spring morning, warm haze | 48% 43% |
| hoi-an-lantern-dusk | Destination / Southeast Asia | Riverside heritage lane with abstract warm lantern glow, no glyphs | Calm dusk | 50% 42% |
| chiang-mai-mountain-temple | Destination / Southeast Asia | Forested mountain temple roofs seen from a garden path | Dry-season morning | 50% 43% |
| luang-prabang-mekong | Destination / Southeast Asia | Mekong riverbank, wooded hills, and small local boats | Golden morning mist | 52% 40% |
| palawan-lagoon | Destination / Southeast Asia | Limestone lagoon with clear water and a distant kayak | Bright summer morning | 53% 41% |
| borneo-rainforest-river | Destination / Southeast Asia | Dense rainforest river corridor viewed from water level | Humid overcast morning | 50% 41% |
| kerala-backwaters | Destination / South Asia | Palm-lined backwater and one traditional houseboat at distance | Warm early morning | 52% 43% |
| melbourne-laneway-morning | Destination / Oceania | Brick laneway café setting with no signs or identifiable people | Autumn morning | 48% 44% |
| tasmania-wild-coast | Destination / Oceania | Rugged coastal headland and pale surf | Cool spring afternoon | 52% 40% |
| fiji-lagoon | Destination / Oceania | Tropical lagoon, reef shallows, and distant islands | Clear summer midday | 50% 42% |
| overnight-train-cabin | Activity / transport | Tidy sleeper-train cabin viewed diagonally toward the window | Night, low amber cabin light | 52% 45% |
| ferry-island-hopping | Activity / transport | Open ferry deck and island chain beyond the rail | Summer morning | 50% 42% |
| street-food-tasting | Activity / food | Shared table of small street-food dishes, hands only at edge | Warm evening market light | 50% 47% |
| tea-ceremony-table | Activity / food | Tea pot, cups, steam, and quiet natural materials | Soft window morning | 50% 47% |
| night-market-stroll | Activity / culture | Atmospheric market aisle with anonymous distant silhouettes | Night, mixed warm light | 50% 43% |
| snorkeling-lagoon | Activity / outdoor | Wide overhead lagoon view with one small snorkeler above reef | Clear summer morning | 52% 41% |
| wellness-retreat-morning | Activity / lodging | Meditation cushions and open pavilion facing green hills | Cool misty morning | 50% 45% |
| ryokan-room-view | Activity / lodging | Unoccupied tatami guest room opening to an autumn garden | Quiet afternoon | 50% 46% |
| multi-generation-family-holiday | Activity / party | Family group seen from behind walking a coastal path | Mild spring morning | 50% 43% |
| spring-rain-garden | Season | Rain-washed garden path and fresh blossoms | Spring after rain | 50% 43% |
| summer-monsoon-coast | Season | Dark monsoon shelf cloud crossing an empty tropical coast | Summer storm light | 50% 39% |
| autumn-tea-hills | Season | Layered tea hills with russet edges and drifting mist | Autumn dawn | 52% 41% |
| winter-onsen-forest | Season | Empty mineral pool surrounded by snow-covered forest | Winter morning steam | 50% 45% |
| packing-cubes-flatlay | Generic | Open carry-on with neatly arranged blank packing cubes | Soft neutral daylight | 50% 50% |
| quiet-departure-lounge | Generic | Empty airport seating and large windows, no boards or labels | Cool dawn | 50% 44% |
| luggage-carousel-arrival | Generic | Unbranded suitcase approaching on a quiet carousel | Neutral interior light | 50% 45% |
| route-planning-table | Generic | Blank cards, thread route, pencil, and unmarked abstract map | Warm window light | 50% 49% |
| train-window-landscape | Generic | Countryside framed through an unlabelled train window | Late-afternoon light | 54% 44% |

## Batch B — Europe

| Id | Kind / coverage | Scene and composition | Conditions | Focal |
| --- | --- | --- | --- | --- |
| london-riverside-morning | Destination / Europe | Broad river walk, layered historic and contemporary masonry, no landmark hero | Cloudy spring morning | 50% 42% |
| edinburgh-old-town-mist | Destination / Europe | Steep stone old-town lane and roofline | Autumn mist, early morning | 50% 42% |
| lisbon-hillside-tram | Destination / Europe | Yellow tram turning through a tiled hillside street, no route text | Summer morning | 48% 45% |
| porto-riverside-dawn | Destination / Europe | Terraced riverfront facades reflected in calm water | Clear dawn | 52% 41% |
| venice-canal-morning | Destination / Europe | Quiet narrow canal, worn facades, and one distant boat | Soft spring morning | 50% 44% |
| florence-rooftops-sunset | Destination / Europe | Warm tiled rooftops and layered Tuscan city fabric | Autumn sunset | 50% 40% |
| vienna-cafe-street | Destination / Europe | Elegant café terrace on a calm historic street | Winter morning, soft light | 50% 45% |
| prague-rooftops-dawn | Destination / Europe | Red roofs, spires as distant texture, and river haze | Spring dawn | 52% 40% |
| budapest-danube-evening | Destination / Europe | Wide riverside city view with bridge lights, no landmark hero | Blue-hour evening | 50% 41% |
| copenhagen-harbour | Destination / Europe | Bicycles and restrained colourful harbour facades | Breezy summer morning | 48% 44% |
| stockholm-archipelago | Destination / Europe | Pine islands and a small red cabin across calm water | Summer afternoon | 52% 42% |
| norwegian-fjord-village | Destination / Europe | Small village beneath steep green fjord walls | Cloudy spring morning | 50% 39% |
| iceland-black-sand-coast | Destination / Europe | Black-sand shore, sea stacks as distant geology, and surf | Winter overcast afternoon | 52% 40% |
| bavarian-alpine-village | Destination / Europe | Alpine village edge, meadow, and mountain backdrop | Early autumn morning | 50% 43% |
| provence-lavender-road | Destination / Europe | Narrow rural lane between lavender fields and stone farmhouse | Summer golden hour | 50% 44% |
| croatian-adriatic-town | Destination / Europe | Limestone coastal town climbing above blue water | Summer morning | 52% 42% |
| slovenia-lake-morning | Destination / Europe | Forested alpine lake and small boat, no iconic church emphasis | Misty autumn dawn | 50% 41% |
| ireland-atlantic-cliffs | Destination / Europe | Grassy Atlantic cliff path and white surf | Windy spring afternoon | 50% 40% |
| canal-boat-journey | Activity / transport | Small canal boat gliding past trees and old brick walls | Summer morning | 52% 44% |
| bakery-crawl | Activity / food | Assorted pastries on a café table, anonymous hands at edge | Morning window light | 50% 48% |
| vineyard-lunch | Activity / food | Rustic outdoor lunch table overlooking vine rows | Early autumn midday | 50% 47% |
| historic-architecture-walk | Activity / culture | Two distant travellers walking a varied historic streetscape | Spring afternoon | 50% 43% |
| classical-concert-hall | Activity / culture | Empty ornate concert hall and stage before performance | Warm evening light | 50% 41% |
| alpine-ski-touring | Activity / outdoor | Two small ski tourers crossing a broad alpine snowfield | Winter sunrise | 52% 40% |
| coastal-cliff-hike | Activity / outdoor | Hiker seen from behind on a high coastal trail | Spring afternoon | 50% 42% |
| boutique-hotel-breakfast | Activity / lodging | Breakfast tray beside an unbranded boutique-room window | Soft morning | 50% 48% |
| anniversary-city-break | Activity / party | Couple from behind crossing an elegant city square | Autumn evening | 50% 43% |
| spring-meadow-cottage | Season | Wildflower meadow around a small neutral stone cottage | Spring morning | 50% 43% |
| summer-mediterranean-evening | Season | Quiet coastal terrace facing a warm sea horizon | Summer dusk | 50% 42% |
| autumn-vineyard-mist | Season | Empty vineyard rows descending into pale mist | Autumn dawn | 52% 40% |
| winter-european-lake | Season | Frozen lakeshore, bare trees, distant village lights | Winter blue hour | 50% 41% |
| hotel-key-and-luggage | Generic | Plain key card and unbranded suitcase on a neutral bench | Warm interior light | 50% 49% |
| rainy-window-departure | Generic | Rain trails on a transit window, terminal shapes beyond | Grey morning | 52% 43% |
| carry-on-cafe-table | Generic | Small carry-on beside a plain café table and cup | Soft daylight | 50% 47% |
| boarding-gate-silhouette | Generic | Anonymous distant travellers at an unlabelled gate window | Cool dawn | 50% 42% |
| weekend-bag-entryway | Generic | Packed canvas bag and shoes in a simple entryway | Warm morning | 50% 49% |

## Batch C — North and Latin America

| Id | Kind / coverage | Scene and composition | Conditions | Focal |
| --- | --- | --- | --- | --- |
| los-angeles-coast-sunset | Destination / North America | Pacific bluff road and layered coast, no sign or landmark | Summer sunset | 52% 40% |
| yosemite-valley-morning | Destination / North America | Broad granite valley mood with river and pines, no exact viewpoint claim | Spring morning | 50% 39% |
| utah-canyon-road | Destination / North America | Empty road threading red-rock canyon country | Autumn golden hour | 50% 44% |
| hawaii-volcanic-coast | Destination / North America | Dark lava coast, tropical plants, and open ocean | Summer morning | 52% 41% |
| chicago-river-dawn | Destination / North America | Layered urban river canyon reflected in calm water | Clear spring dawn | 50% 40% |
| new-orleans-courtyard | Destination / North America | Leafy wrought-iron courtyard without readable signs | Humid morning | 50% 45% |
| miami-art-deco-morning | Destination / North America | Pastel geometric facades and palms, no hotel names | Bright winter morning | 50% 43% |
| vancouver-harbour-mountains | Destination / North America | Harbour edge backed by forested mountains | Cloudy spring morning | 52% 40% |
| banff-turquoise-lake | Destination / North America | Turquoise alpine lake and forested peaks | Summer morning | 50% 40% |
| toronto-islands-skyline | Destination / North America | Green island shoreline facing a distant city skyline | Summer afternoon | 50% 41% |
| alaska-glacier-bay | Destination / North America | Glacial bay with ice, mountains, and one distant small vessel | Cool summer morning | 52% 39% |
| mexico-city-courtyard | Destination / Latin America | Colourful planted courtyard with broad city-home character | Spring morning | 50% 45% |
| costa-rica-cloud-forest | Destination / Latin America | Mossy cloud-forest trail and layered canopy | Rainy-season morning | 50% 42% |
| havana-seafront-dawn | Destination / Latin America | Weathered seafront street with classic car in far background | Dawn after rain | 50% 43% |
| cartagena-balconies | Destination / Latin America | Warm colonial balconies, flowering vines, empty lane | Early morning | 50% 44% |
| rio-coast-morning | Destination / Latin America | Sweeping urban coast backed by rounded green hills | Summer morning | 52% 40% |
| cusco-andean-rooftops | Destination / Latin America | Earthen-tile rooftops stepping toward Andean hills | Dry-season dawn | 50% 41% |
| buenos-aires-cafe-street | Destination / Latin America | Shaded corner café on an elegant residential street | Autumn morning | 50% 45% |
| campervan-road-trip | Activity / transport | Unbranded campervan stopped beside a broad scenic road | Late-afternoon light | 52% 44% |
| taco-cooking-table | Activity / food | Hands assembling tacos from colourful ingredients, no faces | Warm kitchen light | 50% 49% |
| coffee-farm-tasting | Activity / food | Coffee cups and beans on a farm veranda overlooking green rows | Misty morning | 50% 47% |
| live-music-evening | Activity / culture | Small intimate live-music room, musicians distant and unidentifiable | Warm night light | 50% 42% |
| national-park-camping | Activity / outdoor | Small tent beneath pines and broad mountain sky | Summer sunrise | 50% 43% |
| kayaking-mangroves | Activity / outdoor | One kayaker from behind in a wide mangrove channel | Bright morning | 52% 42% |
| beach-resort-hammock | Activity / lodging | Empty hammock between palms facing a quiet shore | Summer afternoon | 50% 45% |
| friends-weekend-trip | Activity / party | Small friend group from behind overlooking a city from a terrace | Golden hour | 50% 43% |
| solo-travel-viewpoint | Activity / party | Single distant traveller from behind at a broad viewpoint | Cool dawn | 50% 41% |
| spring-desert-bloom | Season | Low desert flowers across open arid hills | Spring morning | 50% 43% |
| summer-thunderstorm-plains | Season | Dramatic storm crossing empty grassland beneath wide sky | Summer afternoon | 50% 37% |
| autumn-maple-lake | Season | Red and gold forest reflected in a quiet lake | Autumn morning | 50% 41% |
| winter-rockies-sunrise | Season | Snowy mountain valley catching first pink light | Winter dawn | 50% 39% |
| road-atlas-dashboard | Generic | Unmarked paper road atlas folded on a parked car dashboard | Soft daylight | 50% 48% |
| airport-walkway-light | Generic | Empty moving walkway with abstract window light, no signs | Cool morning | 50% 43% |
| camera-and-sunglasses | Generic | Unbranded camera and sunglasses on a neutral travel table | Warm daylight | 50% 49% |
| reusable-bottle-backpack | Generic | Plain reusable bottle beside an open daypack | Natural window light | 50% 49% |
| motel-arrival-twilight | Generic | Unbranded roadside room door and suitcase, no location cues | Twilight | 50% 45% |

## Batch D — Africa, Middle East, and gap fill

| Id | Kind / coverage | Scene and composition | Conditions | Focal |
| --- | --- | --- | --- | --- |
| kanazawa-garden-winter | Destination / East Asia | Snow-dusted garden path, pines, and traditional roofline | Winter morning | 50% 43% |
| busan-coast-morning | Destination / East Asia | Layered coastal neighbourhood above the sea | Spring morning | 52% 41% |
| zhangjiajie-mist-mountains | Destination / East Asia | Tall sandstone pillars receding into mist, broad nature view | Rainy spring dawn | 50% 38% |
| mongolia-steppe-camp | Destination / East Asia | Wide steppe, two plain round tents, and distant horses | Summer golden hour | 52% 43% |
| kuala-lumpur-tropical-rooftops | Destination / Southeast Asia | Tropical neighbourhood rooftops beneath a modern skyline, no landmark hero | After-rain morning | 50% 40% |
| siem-reap-forest-temples | Destination / Southeast Asia | Weathered stone passage held by forest roots, no exact temple claim | Humid dawn | 50% 42% |
| komodo-island-coast | Destination / Southeast Asia | Dry folded islands, pink-tinted shore, and turquoise channel | Summer morning | 52% 40% |
| jaipur-courtyard-morning | Destination / South Asia | Rose-toned arcaded courtyard without palace-specific claims | Dry-season morning | 50% 44% |
| nepal-himalayan-village | Destination / South Asia | Stone village path beneath distant Himalayan peaks | Autumn morning | 50% 42% |
| sri-lanka-tea-hills | Destination / South Asia | Curving tea rows, shade trees, and distant workers as tiny figures | Misty morning | 52% 41% |
| istanbul-bosphorus-dawn | Destination / Middle East | Ferry wake crossing broad strait, layered city silhouettes | Dawn haze | 50% 40% |
| jordan-wadi-desert | Destination / Middle East | Expansive sandstone valley and one tiny vehicle track | Winter golden hour | 52% 41% |
| oman-mountain-wadi | Destination / Middle East | Rocky wadi with clear pools and date palms | Spring morning | 50% 42% |
| serengeti-dawn | Destination / Africa | Open savanna with distant wildlife silhouettes, no close animals | Golden dawn | 50% 40% |
| zanzibar-stone-town | Destination / Africa | Coral-stone lane, carved doors as texture, no readable signage | Warm morning | 50% 44% |
| namibia-dunes | Destination / Africa | Graphic dune ridges and a tiny line of desert shrubs | Cool dawn | 52% 39% |
| cairo-nile-evening | Destination / Africa | Broad river with small boats and layered urban banks | Blue-hour evening | 50% 41% |
| queensland-reef-islands | Destination / Oceania | Aerial reef shallows and green islands, no resort branding | Clear summer morning | 52% 40% |
| desert-road-journey | Activity / transport | Unbranded vehicle small against an empty desert road | Golden hour | 52% 44% |
| spice-market-cooking | Activity / food | Hands preparing a meal among bowls of spices, no market text | Warm afternoon | 50% 49% |
| artisan-workshop-visit | Activity / culture | Traveller observing pottery or weaving from behind, artwork non-specific | Soft workshop daylight | 50% 45% |
| archaeological-site-walk | Activity / culture | Small guided group crossing broad ancient ruins, faces distant | Winter morning | 50% 42% |
| safari-game-drive | Activity / outdoor | Open vehicle at distance crossing savanna, wildlife far away | Dawn | 52% 42% |
| desert-camp-evening | Activity / lodging | Quiet tented camp and lantern glow beneath open sky | Dusk | 50% 45% |
| eco-lodge-rainforest | Activity / lodging | Modest timber lodge veranda opening to dense green canopy | Rainy morning | 50% 44% |
| honeymoon-island-escape | Activity / party | Couple from behind walking an empty tropical shoreline | Sunset | 50% 43% |
| accessible-travel-city-break | Activity / party | Wheelchair user and companion from behind on a broad step-free promenade | Spring morning | 50% 44% |
| spring-wildflower-valley | Season | Broad green valley scattered with wildflowers | Spring morning | 50% 42% |
| summer-tropical-rain | Season | Heavy rain over lush palms and a quiet veranda | Summer afternoon | 50% 42% |
| autumn-savanna-gold | Season | Tall golden grass and acacia silhouettes beneath clear sky | Autumn sunset | 50% 41% |
| winter-desert-night | Season | Cool desert dunes beneath a dense star field, no camp | Winter night | 50% 39% |
| itinerary-cards-flatlay | Generic | Blank itinerary cards arranged with a plain pencil and clips | Neutral daylight | 50% 50% |
| charging-kit-travel | Generic | Unbranded charging cables and adapters in an open pouch | Soft daylight | 50% 50% |
| luggage-rack-room | Generic | Plain suitcase on a hotel luggage rack, neutral room | Warm interior light | 50% 47% |
| sunrise-through-window | Generic | First light through an anonymous transit or hotel window | Sunrise | 52% 42% |
| compass-and-boots | Generic | Unmarked compass beside walking boots on a neutral floor | Natural morning | 50% 49% |

## Inventory checkpoints

| Batch | Destination | Activity | Season | Generic | Total | State |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| A | 18 | 9 | 4 | 5 | 36 | Generated and accepted |
| B | 18 | 9 | 4 | 5 | 36 | Locked, not generated |
| C | 18 | 9 | 4 | 5 | 36 | Locked, not generated |
| D | 18 | 9 | 4 | 5 | 36 | Locked, not generated |
| **Added** | **72** | **36** | **16** | **20** | **144** | |

The locked destination allocation reaches the final regional totals in the parent plan. The
activity allocation contributes six assets to each intent group across the four batches, bringing
each group from two to eight. The four season rows and five generic rows in each batch are
materially different in setting and composition from the earlier batches.
