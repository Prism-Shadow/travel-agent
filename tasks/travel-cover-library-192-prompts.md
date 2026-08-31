# Travel cover library v2 prompt matrix

Status: locked for generation

This matrix assigns the 144 new catalog ids before generation. It is the working source for the
four ImageGen batches in [`travel-cover-library-192.md`](travel-cover-library-192.md). Accepted
assets move into the production manifest only with their completed batch.

## Shared recipe (`promptVersion: 2`)

Every row is generated with one independent built-in ImageGen call using this shared direction:

> Use case: photorealistic-natural. Asset type: full-bleed travel conversation card cover.
> Original premium editorial travel photography with realistic natural textures and believable
> geography. Landscape 4:3 composition; strongest subject in the middle and upper half; quieter
> lower third reserved for a dark gradient and white UI copy. Natural color, restrained processing,
> no staged stock-photo polish. No readable text, pseudo-text, logos, watermarks, brand marks,
> frames, UI, flags used as labels, close-up identifiable faces, copied artwork, or misleading
> depiction of a specific hotel, room, restaurant, flight, attraction, or POI. Avoid anatomical
> errors, duplicated objects, impossible reflections, warped vehicles, and broken architecture.

The row contributes the scene, category context, weather/time, composition, and crop focal point.
Destination scenes communicate a broad place mood rather than documentary evidence. Generic scenes
must remain location-neutral. All runtime derivatives are 960×720 sRGB progressive JPEGs with
metadata removed.

## Batch A — Asia and Oceania

### Destinations (18)

| ID | Region | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- | --- |
| `beijing-hutong-dawn` | East Asia | Quiet Beijing hutong courtyard lane with gray brick, bicycles, and leafy trees | Spring, clear | Soft dawn | Eye-level lane perspective, no readable door couplets | 50% 44% |
| `hong-kong-harbour-rain` | East Asia | Layered Hong Kong harbour and hillside towers through a passing rain shower | Summer rain | Blue hour | Wide elevated harbour view, no branded boats | 54% 40% |
| `taipei-teahouse-lane` | East Asia | Rain-washed Taipei hillside teahouse lane with warm windows and greenery | Autumn drizzle | Early evening | Gently descending lane, architecture in upper half | 48% 43% |
| `osaka-canal-evening` | East Asia | Lively Osaka canal district reflected in water, with abstract warm shop light | All seasons | Evening | Wide canal curve, no signs or legible advertisements | 50% 41% |
| `hokkaido-flower-fields` | East Asia | Rolling Hokkaido flower fields and distant low mountains | Summer, clear | Morning | Layered bands of flowers, no people in foreground | 52% 42% |
| `jeju-volcanic-coast` | East Asia | Jeju black volcanic coast, green grasses, and wind-shaped sea | Spring, breezy | Late morning | Low coastal overlook, horizon in upper third | 52% 41% |
| `guilin-karst-river` | East Asia | Misty Guilin karst hills beside a calm broad river | Spring mist | Morning | Wide river bend with small unbranded skiff | 50% 39% |
| `chengdu-teahouse-garden` | East Asia | Shaded Chengdu garden teahouse with bamboo, wooden tables, and steam | Summer, humid | Diffuse afternoon | Empty foreground table, garden depth above | 50% 46% |
| `hanoi-old-quarter` | Southeast Asia | Hanoi old-quarter street with narrow facades, trees, and parked bicycles | Spring, overcast | Morning | Street-level vanishing point, no signs or close faces | 48% 43% |
| `hoi-an-lantern-dusk` | Southeast Asia | Riverside heritage town in central Vietnam with warm unlettered lantern glow | Dry season | Dusk | Broad river reflection and small facades | 50% 42% |
| `chiang-mai-mountain-temple` | Southeast Asia | Northern Thailand mountain temple courtyard framed by forest and mist | Cool dry season | Dawn | Broad courtyard, generalized architecture, no worshippers close-up | 50% 43% |
| `luang-prabang-mekong` | Southeast Asia | Luang Prabang mood with a quiet Mekong bend, wooded hills, and low riverside roofs | Dry season | Golden morning | Elevated river panorama | 52% 40% |
| `palawan-lagoon` | Southeast Asia | Limestone lagoon in Palawan with clear turquoise water and a tiny kayak | Summer, calm | Mid-morning | Wide water foreground, cliffs in upper half | 53% 41% |
| `borneo-rainforest-river` | Southeast Asia | Dense Borneo rainforest along a winding brown-green river | Tropical, light mist | Morning | Low boat-level view without visible boat branding | 50% 41% |
| `kerala-backwaters` | South Asia and Middle East | Kerala backwater canal with palms, local wooden boat, and quiet village greenery | Tropical, clear | Early morning | Wide canal perspective, no close people | 52% 43% |
| `melbourne-laneway-morning` | Oceania | Melbourne laneway café mood with brick, plants, bicycles, and unlettered awnings | Autumn, dry | Morning | Eye-level lane, no copied street art or readable menus | 48% 44% |
| `tasmania-wild-coast` | Oceania | Rugged Tasmanian headland, pale rock, heath, and deep blue sea | Spring, windy | Late afternoon | Wide coastal overlook | 52% 40% |
| `fiji-lagoon` | Oceania | Fiji island lagoon with palms, shallow turquoise water, and distant green hills | Dry season | Bright morning | Water-led panorama, no resort structures | 50% 42% |

### Activities (9)

| ID | Intent group | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- | --- |
| `overnight-train-cabin` | Transport | Calm sleeper-train compartment with made bunks and a blurred landscape outside | All | Warm evening interior | Wide compartment view, no tickets or labels | 52% 45% |
| `ferry-island-hopping` | Transport | Passenger ferry deck approaching green islands across bright water | Summer, breezy | Morning | Rail leading toward islands, people only as distant silhouettes | 50% 42% |
| `street-food-tasting` | Food | Hands sharing several freshly cooked street-food plates at an open-air table | All | Warm evening | Overhead three-quarter table, no faces or packaging | 50% 47% |
| `tea-ceremony-table` | Food | Quiet tea tasting with ceramic cups, kettle, wood grain, and garden beyond | All | Soft afternoon | Table in middle, hands optional and anatomically natural | 50% 47% |
| `night-market-stroll` | Culture/city | Travelers walking through a warm night market aisle with abstract stalls | All | Evening | Rear wide view, no readable signs or identifiable faces | 50% 43% |
| `snorkeling-lagoon` | Outdoor adventure | Single snorkeler seen from a safe distance over clear tropical reef water | Summer, calm | Midday | Split-level or elevated wide view, body fully coherent | 52% 41% |
| `wellness-retreat-morning` | Lodging/relaxation | Serene open-air wellness deck facing forested hills, cushions and tea ready | All | Misty morning | Empty deck, no specific property identity | 50% 45% |
| `ryokan-room-view` | Lodging/relaxation | Generalized Japanese-style guest room opening to a quiet seasonal garden | Autumn | Morning | Wide interior, no copied art or branded amenities | 50% 46% |
| `multi-generation-family-holiday` | Travel party/occasion | Multi-generation family walking together along a broad waterfront promenade | Spring | Late afternoon | Rear wide view, faces not identifiable | 50% 43% |

### Season and weather (4)

| ID | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- |
| `spring-rain-garden` | Fresh garden path with flowering shrubs after rain | Spring drizzle | Diffuse morning | Path leading upward through foliage | 50% 43% |
| `summer-monsoon-coast` | Tropical coast under dramatic monsoon clouds with distant rain shafts | Summer monsoon | Late afternoon | Wide horizon, safe calm foreground | 50% 39% |
| `autumn-tea-hills` | Terraced tea hills turning warm green and amber in cool mist | Autumn mist | Morning | Layered hills, no identifiable destination | 52% 41% |
| `winter-onsen-forest` | Steaming outdoor mineral pool within a snowy forest, no bathers | Winter snow | Blue morning | Pool edge low, forest in upper half | 50% 45% |

### Generic fallbacks (5)

| ID | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- |
| `packing-cubes-flatlay` | Open carry-on with neutral packing cubes and folded travel clothes | Neutral | Soft daylight | Clean overhead arrangement, no labels | 50% 50% |
| `quiet-departure-lounge` | Location-neutral airport lounge with empty seats and large windows | Neutral | Morning | Wide architectural view, no signs or aircraft marks | 50% 44% |
| `luggage-carousel-arrival` | Plain suitcases moving on an unbranded baggage carousel | Neutral | Diffuse interior | Low wide view, no tags or signage | 50% 45% |
| `route-planning-table` | Hands arranging blank route cards beside a phone, notebook, and compass | Neutral | Window daylight | Overhead table, all paper blank | 50% 49% |
| `train-window-landscape` | Abstract countryside passing outside a train window with a quiet empty seat | Neutral | Late afternoon | Window dominates upper area, no location clues | 54% 44% |

## Batch B — Europe

### Destinations (18)

| ID | Region | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- | --- |
| `london-riverside-morning` | Europe | Broad London riverside mood with layered historic and modern architecture | Spring, cloudy | Morning | Wide river view without a single landmark dominating | 50% 41% |
| `edinburgh-old-town-mist` | Europe | Edinburgh old-town stone roofs climbing a misty hillside | Autumn mist | Morning | Elevated roofscape, castle-like forms generalized | 52% 40% |
| `lisbon-hillside-tram` | Europe | Lisbon hillside street with a small vintage tram, tiled facades, and warm light | Spring | Late afternoon | Street slope upward, no route numbers or text | 48% 43% |
| `porto-riverside-dawn` | Europe | Porto riverfront roofs and small boats in pale dawn haze | Spring, clear | Dawn | Wide river curve, no vessel branding | 52% 40% |
| `venice-canal-morning` | Europe | Quiet Venetian canal with weathered facades and one distant small boat | Autumn | Early morning | Canal vanishing point, generalized setting | 50% 42% |
| `florence-rooftops-sunset` | Europe | Warm Florence roofscape with terracotta tiles and distant Tuscan hills | Summer | Sunset | Elevated panorama, no landmark close-up | 50% 39% |
| `vienna-cafe-street` | Europe | Elegant Vienna café street with cream facades and outdoor tables | Spring | Morning | Street-level view, awnings and menus blank | 50% 44% |
| `prague-rooftops-dawn` | Europe | Prague red roofs and river haze under a pale dawn sky | Autumn | Dawn | Broad elevated view, no landmark as evidence | 52% 40% |
| `budapest-danube-evening` | Europe | Budapest river embankment glowing softly across the Danube | All | Blue hour | Wide river composition, architecture generalized | 50% 40% |
| `copenhagen-harbour` | Europe | Copenhagen harbour mood with colorful simple facades and bicycles | Summer, clear | Morning | Water-level panorama, no signs or flags | 48% 42% |
| `stockholm-archipelago` | Europe | Stockholm archipelago ferry route through low rocky green islands | Summer | Long evening | Wide water view, distant unbranded ferry | 52% 40% |
| `norwegian-fjord-village` | Europe | Small Norwegian fjord village beneath steep green mountains | Summer, cloud breaks | Morning | Wide fjord perspective, no close people | 50% 41% |
| `iceland-black-sand-coast` | Europe | Icelandic black-sand coast with basalt shapes, surf, and low mist | Autumn, windy | Afternoon | Wide shore, safe distant waves | 50% 41% |
| `bavarian-alpine-village` | Europe | Bavarian alpine village meadows and timber houses beneath mountains | Spring | Morning | Broad valley, no flags or readable signs | 52% 42% |
| `provence-lavender-road` | Europe | Narrow rural road through Provence lavender fields and pale stone farmhouse | Summer | Golden morning | Road leads through lower center | 50% 43% |
| `croatian-adriatic-town` | Europe | Croatian Adriatic hillside town above clear blue water | Summer | Late morning | Wide coastal panorama, no single famous site | 52% 41% |
| `slovenia-lake-morning` | Europe | Quiet Slovenian alpine lake with forest and a small generic lakeside chapel | Autumn mist | Morning | Reflection-centered wide view | 50% 42% |
| `ireland-atlantic-cliffs` | Europe | Green Irish Atlantic cliffs, walking path, and textured ocean | Spring, windy | Afternoon | Wide headland, no people close-up | 50% 40% |

### Activities (9)

| ID | Intent group | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- | --- |
| `canal-boat-journey` | Transport | Small passenger canal boat moving through a quiet historic waterway | Spring | Morning | Wide bank-level view, no boat names | 50% 43% |
| `bakery-crawl` | Food | Selection of fresh breads and pastries shared on a café table | All | Morning | Overhead three-quarter table, no menus or branding | 50% 48% |
| `vineyard-lunch` | Food | Relaxed outdoor lunch table overlooking rows of vines | Summer | Midday shade | Wide table and vineyard, faces absent | 50% 47% |
| `historic-architecture-walk` | Culture/city | Two travelers exploring a layered historic neighborhood on foot | Spring | Afternoon | Rear wide view, architecture coherent | 50% 43% |
| `classical-concert-hall` | Culture/city | Grand but generalized concert hall interior before a performance | All | Warm interior | Wide symmetric hall, no posters or copied artwork | 50% 44% |
| `alpine-ski-touring` | Outdoor adventure | Two distant ski tourers crossing a broad alpine snowfield | Winter, clear | Morning | Wide mountain view, full coherent bodies | 52% 41% |
| `coastal-cliff-hike` | Outdoor adventure | Hikers following a safe coastal headland path above the sea | Spring, breezy | Afternoon | Rear distant figures, path leading upward | 50% 42% |
| `boutique-hotel-breakfast` | Lodging/relaxation | Breakfast tray beside an open window in a refined unbranded guest room | All | Morning | Room-wide composition, no property identity | 50% 47% |
| `anniversary-city-break` | Travel party/occasion | Couple sharing a quiet terrace view over an old city | Autumn | Sunset | Rear medium-wide view, faces not identifiable | 50% 43% |

### Season and weather (4)

| ID | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- |
| `spring-meadow-cottage` | Wildflower meadow and a small generic stone cottage | Spring, clear | Morning | Meadow foreground, cottage upper center | 52% 43% |
| `summer-mediterranean-evening` | Warm coastal terrace looking toward a calm sea, no place identity | Summer | Long evening | Wide open view, blank table in lower third | 50% 43% |
| `autumn-vineyard-mist` | Vineyard rows fading into pale morning mist | Autumn mist | Dawn | Graphic row perspective | 50% 42% |
| `winter-european-lake` | Frozen forest lake edged with fresh snow and simple cabins | Winter | Blue morning | Wide reflection view, no destination clues | 50% 42% |

### Generic fallbacks (5)

| ID | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- |
| `hotel-key-and-luggage` | Unbranded blank key card beside a small suitcase in a neutral room | Neutral | Warm afternoon | Side table and luggage, no numbers or logos | 50% 48% |
| `rainy-window-departure` | Travel bag beside a rain-streaked terminal window | Neutral rain | Blue daylight | Bag low, abstract exterior above | 50% 46% |
| `carry-on-cafe-table` | Compact carry-on beside a café table with coffee and blank notebook | Neutral | Morning | Ground-level three-quarter view, no menu text | 50% 47% |
| `boarding-gate-silhouette` | Distant traveler silhouettes waiting beside a bright terminal window | Neutral | Dawn | Wide backlit space, no gate numbers or signs | 50% 43% |
| `weekend-bag-entryway` | Packed weekend bag, coat, and shoes ready in a simple entryway | Neutral | Soft morning | Still-life arrangement, no labels | 50% 48% |

## Batch C — North and Latin America

### Destinations (18)

| ID | Region | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- | --- |
| `los-angeles-coast-sunset` | North America | Southern California coast road and layered ocean haze | Summer | Sunset | Elevated wide coast, no recognizable property | 52% 40% |
| `yosemite-valley-morning` | North America | Granite valley, pine forest, and meadow in a broad national-park mood | Spring | Morning | Wide landscape, no people close-up | 50% 39% |
| `utah-canyon-road` | North America | Empty paved road winding between red-rock desert formations | Autumn, clear | Golden afternoon | Road leads from lower center | 50% 42% |
| `hawaii-volcanic-coast` | North America | Hawaiian black-lava coastline with lush green slopes and blue water | Summer | Morning | Wide headland, no resort structures | 52% 41% |
| `chicago-river-dawn` | North America | Chicago river canyon of varied architecture in pale dawn light | Spring | Dawn | Water-level wide view, no logos | 50% 41% |
| `new-orleans-courtyard` | North America | Lush New Orleans courtyard with iron balcony and warm stucco | Spring, humid | Morning | Empty generalized courtyard, no signs | 50% 45% |
| `miami-art-deco-morning` | North America | Pastel coastal art-deco street mood with palms and classic cars | Winter, clear | Morning | Wide street view, no signs or brand marks | 50% 43% |
| `vancouver-harbour-mountains` | North America | Vancouver harbour city edge backed by forested mountains | Spring | Morning | Wide water panorama, no branded vessels | 52% 40% |
| `banff-turquoise-lake` | North America | Turquoise alpine lake, larch forest, and Canadian Rockies | Autumn | Morning | Broad lakeshore, no specific lodge | 50% 40% |
| `toronto-islands-skyline` | North America | Toronto skyline seen across calm water from a leafy island shore | Summer | Late afternoon | Wide distant city view | 50% 40% |
| `alaska-glacier-bay` | North America | Blue glacier meeting a quiet bay beneath rugged Alaska mountains | Summer, overcast | Midday | Wide water-led composition, wildlife absent | 50% 40% |
| `mexico-city-courtyard` | Latin America | Leafy Mexico City courtyard with colorful walls and tiled floor | Spring | Morning | Empty generalized courtyard, no mural copies | 50% 45% |
| `costa-rica-cloud-forest` | Latin America | Costa Rican cloud forest canopy with hanging moss and a footpath | Wet season mist | Morning | Path through dense green layers | 50% 43% |
| `havana-seafront-dawn` | Latin America | Havana seafront mood with weathered pastel facades and ocean spray | Winter, breezy | Dawn | Broad coastal street, no political text or flags | 50% 42% |
| `cartagena-balconies` | Latin America | Cartagena old-city street with shaded balconies and tropical plants | Dry season | Morning | Street perspective, no readable signs | 48% 44% |
| `rio-coast-morning` | Latin America | Rio coastal city mood with curved bay, green hills, and beach | Summer | Morning | Very wide panorama, landmarks not dominant | 52% 40% |
| `cusco-andean-rooftops` | Latin America | Cusco terracotta roofscape beneath high Andean hills | Dry season | Golden morning | Elevated city panorama | 50% 41% |
| `buenos-aires-cafe-street` | Latin America | Buenos Aires neighborhood café street with trees and ornate facades | Autumn | Morning | Eye-level street, menus and awnings blank | 48% 44% |

### Activities (9)

| ID | Intent group | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- | --- |
| `campervan-road-trip` | Transport | Unbranded campervan stopped at a broad scenic overlook | Summer | Morning | Wide landscape, vehicle coherent and secondary | 52% 43% |
| `taco-cooking-table` | Food | Hands assembling colorful tacos from fresh ingredients at a home table | All | Daylight | Overhead three-quarter view, no packaging | 50% 49% |
| `coffee-farm-tasting` | Food | Coffee tasting table overlooking green mountain farm rows | All | Morning | Cups in middle, hills above, no labels | 50% 47% |
| `live-music-evening` | Culture/city | Small unbranded live-music courtyard with musicians seen from a distance | All | Evening | Wide atmospheric view, no posters or close faces | 50% 43% |
| `national-park-camping` | Outdoor adventure | Small tent at a designated forest campsite beneath a broad night sky | Summer | Blue hour | Tent upper-middle, fire safely contained or absent | 50% 43% |
| `kayaking-mangroves` | Outdoor adventure | Two kayaks moving through a calm mangrove waterway | Warm season | Morning | Wide rear view, complete paddles and bodies | 50% 42% |
| `beach-resort-hammock` | Lodging/relaxation | Empty hammock and shaded terrace facing a generic tropical beach | Summer | Late afternoon | No resort branding or identifiable property | 50% 45% |
| `friends-weekend-trip` | Travel party/occasion | Small group of friends at a scenic overlook with backpacks | Autumn | Afternoon | Rear wide view, faces not identifiable | 50% 42% |
| `solo-travel-viewpoint` | Travel party/occasion | Single traveler taking in a broad mountain-and-lake viewpoint | Spring | Morning | Rear distant figure, quiet lower third | 50% 42% |

### Season and weather (4)

| ID | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- |
| `spring-desert-bloom` | Desert valley carpeted with small seasonal wildflowers | Spring bloom | Morning | Wide low landscape, no destination cues | 50% 41% |
| `summer-thunderstorm-plains` | Distant summer thunderstorm crossing open grasslands | Summer storm | Late afternoon | Dramatic sky, safe dry foreground | 50% 38% |
| `autumn-maple-lake` | Maple-colored forest reflected in a still lake | Autumn | Morning | Symmetric reflection, no buildings | 50% 41% |
| `winter-rockies-sunrise` | Snowy mountain range warming under first light | Winter, clear | Sunrise | Wide ridge panorama, no location marker | 50% 39% |

### Generic fallbacks (5)

| ID | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- |
| `road-atlas-dashboard` | Blank folded map and sunglasses on a parked car dashboard | Neutral | Daylight | Close wide still life, map has no legible detail | 50% 48% |
| `airport-walkway-light` | Empty moving walkway beneath repeating terminal skylights | Neutral | Morning | Symmetric architectural perspective, no signs | 50% 43% |
| `camera-and-sunglasses` | Unbranded camera, sunglasses, and compact pouch on a plain table | Neutral | Window daylight | Clean still life, no labels | 50% 49% |
| `reusable-bottle-backpack` | Simple backpack and reusable bottle ready beside a bench | Neutral | Morning | Natural still life, no brand marks | 50% 48% |
| `motel-arrival-twilight` | Generic roadside lodging exterior with a parked suitcase at twilight | Neutral | Twilight | Wide entrance, no signs, logos, or room numbers | 50% 45% |

## Batch D — Africa, Middle East, and gap fill

### Destinations (18)

| ID | Region | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- | --- |
| `kanazawa-garden-winter` | East Asia | Kanazawa garden mood with stone paths, pines, and fresh snow | Winter | Morning | Generalized garden, no famous structure close-up | 50% 43% |
| `busan-coast-morning` | East Asia | Busan hillside neighborhoods meeting a bright rocky coast | Spring | Morning | Wide elevated coast, no readable signs | 52% 41% |
| `zhangjiajie-mist-mountains` | East Asia | Towering quartz-sandstone mountain pillars emerging through mist | Spring mist | Morning | Vertical forms within 4:3 wide landscape | 50% 38% |
| `mongolia-steppe-camp` | East Asia | Broad Mongolian steppe with a few white felt tents and distant horses | Summer | Late afternoon | Vast landscape, no flags or close people | 52% 42% |
| `kuala-lumpur-tropical-rooftops` | Southeast Asia | Kuala Lumpur tropical urban rooftops and leafy streets after rain | All, rain clearing | Late afternoon | Broad city mood, towers not dominant | 50% 41% |
| `siem-reap-forest-temples` | Southeast Asia | Generalized weathered stone temple forms within lush Cambodian forest | Wet season | Morning | Broad path view, no copied relief artwork | 50% 43% |
| `komodo-island-coast` | Southeast Asia | Dry green ridges and clear coves of the Komodo island region | Dry season | Morning | Elevated coastal panorama, wildlife absent | 52% 41% |
| `jaipur-courtyard-morning` | South Asia and Middle East | Jaipur mood through a warm sandstone courtyard with arches and shade | Winter, clear | Morning | Generalized architecture, no landmark replica | 50% 45% |
| `nepal-himalayan-village` | South Asia and Middle East | Nepalese Himalayan village terraces below snowy peaks | Autumn, clear | Morning | Wide valley view, no close faces | 50% 40% |
| `sri-lanka-tea-hills` | South Asia and Middle East | Sri Lankan tea hills with a small train far across the valley | Cool dry season | Morning | Layered green slopes, train coherent and distant | 52% 42% |
| `istanbul-bosphorus-dawn` | South Asia and Middle East | Istanbul Bosphorus mood with ferries, layered roofs, and soft domes | Spring | Dawn | Wide water view, no flags or landmark close-up | 50% 40% |
| `jordan-wadi-desert` | South Asia and Middle East | Monumental red-sand wadi with a winding vehicle track | Autumn, clear | Golden afternoon | Wide rock valley, no people or camps | 50% 40% |
| `oman-mountain-wadi` | South Asia and Middle East | Omani mountain wadi with turquoise pools, palms, and pale rock | Winter | Morning | Wide natural landscape, no resort | 52% 42% |
| `serengeti-dawn` | Africa | East African savanna with acacia silhouettes and distant grazing animals | Dry season | Dawn | Very wide scene, animals anatomically plausible and distant | 50% 40% |
| `zanzibar-stone-town` | Africa | Zanzibar stone-town lane with carved doors and tropical light | Dry season | Morning | Quiet generalized lane, no close people or signs | 48% 44% |
| `namibia-dunes` | Africa | Layered Namibian dunes and sparse desert grass | Dry, clear | Sunrise | Graphic wide dune curves | 50% 40% |
| `cairo-nile-evening` | Africa | Cairo Nile river mood with low boats and layered city haze | Autumn | Evening | Wide river view, no landmark evidence | 50% 41% |
| `queensland-reef-islands` | Oceania | Aerial-oblique view of small coral reef islands in clear Queensland water | Dry season | Mid-morning | Wide natural pattern, no aircraft or resort | 50% 42% |

### Activities (9)

| ID | Intent group | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- | --- |
| `desert-road-journey` | Transport | Unbranded four-wheel-drive vehicle crossing a broad desert road | Dry | Late afternoon | Vehicle small and coherent, road leading upward | 50% 42% |
| `spice-market-cooking` | Food | Hands preparing a colorful meal with bowls of whole spices | All | Window daylight | Overhead three-quarter table, no packaging or signs | 50% 49% |
| `artisan-workshop-visit` | Culture/city | Traveler observing a craftsperson shaping clay in an open workshop | All | Soft afternoon | Wide respectful view, faces not identifiable | 50% 44% |
| `archaeological-site-walk` | Culture/city | Visitors walking through generalized ancient stone ruins in open landscape | Spring | Morning | Rear distant figures, no specific monument claim | 50% 42% |
| `safari-game-drive` | Outdoor adventure | Unbranded open safari vehicle watching distant wildlife on a savanna | Dry season | Early morning | Wide scene, people and animals anatomically coherent | 52% 41% |
| `desert-camp-evening` | Lodging/relaxation | Refined but unbranded canvas camp beneath desert rock at blue hour | Dry | Blue hour | Wide camp mood, no close people | 50% 44% |
| `eco-lodge-rainforest` | Lodging/relaxation | Generalized low-impact lodge deck opening into dense rainforest | Tropical | Misty morning | Empty deck, no property identity | 50% 45% |
| `honeymoon-island-escape` | Travel party/occasion | Couple walking along a quiet island shore with wide sea views | Summer | Sunset | Rear distant figures, faces not identifiable | 50% 42% |
| `accessible-travel-city-break` | Travel party/occasion | Traveler using a wheelchair with companion on a broad accessible promenade | Spring | Afternoon | Rear wide view, coherent mobility aid, faces not identifiable | 50% 43% |

### Season and weather (4)

| ID | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- |
| `spring-wildflower-valley` | Broad green valley scattered with spring wildflowers | Spring | Morning | Layered hills, no destination clue | 50% 41% |
| `summer-tropical-rain` | Heavy warm rain crossing a lush tropical garden path | Summer rain | Afternoon | Visible rain and foliage depth, no buildings | 50% 43% |
| `autumn-savanna-gold` | Tall dry grasses and sparse trees in warm seasonal color | Autumn-like dry season | Late afternoon | Wide grassland, no location claim | 50% 41% |
| `winter-desert-night` | Cool desert dunes beneath a clear starry winter sky | Winter, clear | Night | Wide sky and dune silhouette, no camp | 50% 39% |

### Generic fallbacks (5)

| ID | Subject and scene | Season/weather | Time/light | Composition | Focal point |
| --- | --- | --- | --- | --- | --- |
| `itinerary-cards-flatlay` | Blank cards arranged into a simple day-by-day travel plan | Neutral | Soft daylight | Overhead table, absolutely no writing | 50% 50% |
| `charging-kit-travel` | Compact universal charging kit organized beside a travel pouch | Neutral | Window daylight | Clean still life, no logos or printed symbols | 50% 49% |
| `luggage-rack-room` | Closed suitcase on a simple luggage rack in a neutral guest room | Neutral | Warm afternoon | Wide room corner, no property identity | 50% 47% |
| `sunrise-through-window` | Soft sunrise seen through a generic train or hotel window | Neutral | Sunrise | Window in upper half, no location clues | 50% 43% |
| `compass-and-boots` | Worn walking boots beside a plain compass and folded blank cloth | Neutral | Morning | Natural still life, no map text or branding | 50% 48% |

## Locked totals

| Kind | Batch A | Batch B | Batch C | Batch D | Add | Final with Phase 1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Destination | 18 | 18 | 18 | 18 | 72 | 96 |
| Activity | 9 | 9 | 9 | 9 | 36 | 48 |
| Season/weather | 4 | 4 | 4 | 4 | 16 | 24 |
| Generic fallback | 5 | 5 | 5 | 5 | 20 | 24 |
| **Total** | **36** | **36** | **36** | **36** | **144** | **192** |

Final destination totals, including Phase 1, are East Asia 18, Southeast Asia 12, South Asia and
Middle East 8, Europe 24, North America 14, Latin America 8, Africa 6, and Oceania 6. Final activity
groups contain eight assets each: transport, food, culture/city, outdoor adventure,
lodging/relaxation, and travel party/occasion.
