# Travel cover library batch review

This ledger records generated master identifiers and review outcomes for prompt version 2. Runtime
checksums refer to the optimized 960×720 JPEGs committed under
`packages/web/public/travel-covers/`.

## Batch A — Asia and Oceania

Status: accepted

- Accepted: 36 of 36
- Runtime footprint: 4,832,820 bytes; 134,245 bytes average; 230,176 bytes maximum
- Technical QA: all files are 960×720, three-component, progressive sRGB JPEGs with EXIF, ICC, and
  XMP metadata removed; every file is at most 250 KiB
- Visual QA: all assets were inspected at full size and in 4:3 contact sheets for anatomy,
  architecture, vehicles, reflections, text, marks, subject separation, lower-third readability,
  cultural plausibility, and duplicate risk
- Reworked before acceptance: `beijing-hutong-dawn` (pseudo-text wall panel),
  `osaka-canal-evening` (glyph-like sign), `chengdu-teahouse-garden` (face-like steam),
  `overnight-train-cabin` (window decals), and `route-planning-table` (compass markings)

| Catalog id | ImageGen output id | Bytes | SHA-256 | Review |
| --- | --- | ---: | --- | --- |
| beijing-hutong-dawn | exec-68cc7b28-34b9-413b-a51e-be6e43666dbe | 116005 | 29eea94fd3f2228fb4cc402109c2f7667908b48e90a61ab55fb1eb8f2798bef3 | Accepted after rework |
| hong-kong-harbour-rain | exec-40089bb2-2c0f-4da1-be76-ecb81e9850e6 | 97557 | 910925a7f7624f6e1b3e90ec88f1bb33b62013f75eaf1d8df5935477f50edb8d | Accepted |
| taipei-teahouse-lane | exec-75cb6843-2c4c-4bde-9f93-eb3abaf35f67 | 146766 | 9c1749a3e98bf8b6653c841aab6a063bc54ecf1bae9dd2fa1cbbb60636bdffd4 | Accepted |
| osaka-canal-evening | exec-95c1db07-3b03-46d9-8a58-2cf05730f1e0 | 141629 | 6926f92dcaecb07f33b17607b6b6eebef0e3fb69e5cad87c3d66762fc217042a | Accepted after rework |
| hokkaido-flower-fields | exec-10c204b2-048f-46b3-8a04-1f5f8bfa2ad7 | 124002 | d9fd7d71695c846a281ff06b89c009b47b6b27417672f6bc8fd161484668100f | Accepted |
| jeju-volcanic-coast | exec-1fb46ce1-3f1e-4337-9ba7-f30cf557ed8c | 185011 | be7bc16fbd1fa36f08d42fd9deb9adc9f5c9e24dc897015021145805be8dc411 | Accepted |
| guilin-karst-river | exec-68addecd-e8a5-4d82-bc7b-e1c87e8e0b88 | 78820 | f989f4918ca8d9e9412e01ae2566e12dcad07133c7951d039372ed4f371c7da0 | Accepted |
| chengdu-teahouse-garden | exec-a662fbab-3297-4fb8-b904-9b899db0bc6e | 131613 | 76346f65e77cde7a10d77185903def24291876f41494f1a5d655bf2487c0942e | Accepted after rework |
| hanoi-old-quarter | exec-adb0be72-f735-4f42-8e10-dff41d7394d7 | 202600 | f15a65673dc97357cfde0bd6bc0f7e21ad2a3217ef057a4a12fbec9efcb63cf8 | Accepted |
| hoi-an-lantern-dusk | exec-382f0ace-7269-4712-b5ac-e874bbe011c8 | 133665 | 06634457a2e020176f39fecf416c826957fa61384bb011dffad17b007e341ab5 | Accepted |
| chiang-mai-mountain-temple | exec-09322019-fc4b-4b17-b51a-343a41bf5cc1 | 129470 | c805ab8d1505856789f405023d00d39ce22406a4f5909254a1284d5e750d280e | Accepted |
| luang-prabang-mekong | exec-98a43f4d-04b9-4852-abff-d4c046518647 | 126643 | aa689d2d1213ce65feee9e679877502e0a8131d069ac8770e8ad845962441560 | Accepted |
| palawan-lagoon | exec-d6d8d71b-c7e7-4d1d-8933-a55517f8b14f | 172217 | dd689af7498d96ca4087868c3b3a19ba4d98add0cd76cc329aff6c125c3450f7 | Accepted |
| borneo-rainforest-river | exec-52f45011-1d96-44eb-9916-cfce382ccc37 | 177509 | c4be1b10be1bdeda2ec361c5a7247b91ac3dc6942031a62b04aa60ed5ad2656e | Accepted |
| kerala-backwaters | exec-520744ab-ce53-486b-b9c5-850716e7439a | 162297 | 1e3f90d58cfb328507280d928e6993b65a902e4b8071b344707b4d09b3a50668 | Accepted |
| melbourne-laneway-morning | exec-846e13b5-9e2b-4830-8469-c2df270dc3c0 | 182149 | 544823f0856ece18dfb4e0ccdec6a9ee5fee600062ebca65f1aa5005fb109869 | Accepted |
| tasmania-wild-coast | exec-722797bb-fd11-4354-8382-497acd077eba | 193564 | bf518e1d25c2e1e459a7aec93aba30fe69f2e3a2bdb483750965f7cda948a0ac | Accepted |
| fiji-lagoon | exec-ecdf00cf-8f5b-4f84-95d9-ac982dfa4569 | 127647 | 77d32fa8f19eeced7642e7c9ba2618278d42034b1eec0226c48a97ce4a433dff | Accepted |
| overnight-train-cabin | exec-c25ad009-fb1a-4137-9277-82576b2ebb40 | 80402 | c8e1107af8901d275968acc1170733d06ce194100ac1db06acef8672a2260e96 | Accepted after rework |
| ferry-island-hopping | exec-d8f4e92b-5715-432d-a7f2-9a4e59d82b6d | 90862 | 779c094d61199d2ef0c83e41d5350c1d5b06959e39160d0ee443265bafd14e31 | Accepted |
| street-food-tasting | exec-751994d0-a674-4553-881d-12cc0a9ed984 | 177377 | 332ca7776ba883be9542ffd1aa5885ee492222b02e86a20cef3141fa1145c5d5 | Accepted |
| tea-ceremony-table | exec-49d405f4-4b1a-42a0-a4a7-deb618dc9e39 | 109957 | 424e613e6aeef4c7578db2b44bacdefdda6929d337ada8ad270d64e96d84f8c4 | Accepted |
| night-market-stroll | exec-c085c03d-8839-47e8-b32a-e647067357b4 | 148145 | c23b3b754756a091c8500db15c7e367cc50aabb389ed3e74c388f1b0160ec86d | Accepted |
| snorkeling-lagoon | exec-f1a643e3-5594-4bfa-b516-c09ddd14ad38 | 195465 | fe787d928ca00d6a83090a70ce3ec2380940adb43abc19f4a5a1886cb462ed98 | Accepted |
| wellness-retreat-morning | exec-b2eb75de-4238-44a8-88ab-02485b99383c | 110124 | d582ea00962512b690d4e7420d093b312dc5528cf88feb4c75a21bd3be81cdfa | Accepted |
| ryokan-room-view | exec-64e492f3-6270-4d5c-b0ca-81dc79897bc2 | 161272 | 9861a5b9eb553bfe37a5ef91cc28e942984d25b428d1c94195847656ad28b462 | Accepted |
| multi-generation-family-holiday | exec-dac9c573-5fd7-4d99-b34d-216209a0f148 | 97622 | 0fc59412979d887e4f64a12b1b3558ec691ba0a2d00be4d07dc66ec0d3502002 | Accepted |
| spring-rain-garden | exec-675f341b-35d1-4c6c-93fb-3d3fcd6222b7 | 230176 | af4cde33321c996faad98676b56213687f563686a72b4eab563eb86b8ff4c01a | Accepted |
| summer-monsoon-coast | exec-13b81ada-8c51-4770-bf22-d65b337af6a8 | 74366 | 90b0b6324c56801e7728b1c4be3888b87e42d0eda219f4c92989262c9516fbb2 | Accepted |
| autumn-tea-hills | exec-f636826d-ffbc-4bd5-903c-9319961bbeec | 118921 | ffc5fe641012411c85c88ab8d543098ae0bfd3a060f3e1fbf0ac2bb28897d250 | Accepted |
| winter-onsen-forest | exec-926d75b0-8469-42be-bc3f-183816dc52e5 | 151390 | 00f3c2d9945219f743ff8b4ecdeb511a549b5420a0bfabb0a053ddf9ad58d8bf | Accepted |
| packing-cubes-flatlay | exec-01455afd-2f83-4093-9f46-c1f3a360371e | 108540 | 75a797f2b75cdb9e186b867445b01abf2f522d559be77cf6f2c7afc7bc02f761 | Accepted |
| quiet-departure-lounge | exec-a5853f87-e34c-485b-baad-e17be9db674a | 107672 | 08fcc2367322a379274f343f9f1e6f15aa30697f557842e032173c6cf4e609ff | Accepted |
| luggage-carousel-arrival | exec-41f70565-097f-441a-a418-794e1c680283 | 83411 | edd9adf9ecc4cd934a0b584daa4158baedb0a1a0bd3d7b9524556a051a0c22d3 | Accepted |
| route-planning-table | exec-6b1e4ce7-db48-47e1-825f-2c6be1ea2a23 | 85033 | 43765f585dadabaf6313af6cb9a6e3440196e1df513acbc16a99229cd45081b1 | Accepted after rework |
| train-window-landscape | exec-608b1488-491f-4c02-9af8-b9a185eb4cfa | 72921 | 1d53273b9880389cf1135dd699a4b629ffa473704fc5cce49611a92b8c930a71 | Accepted |

## Batches B–D

Not generated. Their ids and scene specifications are locked in
`tasks/travel-cover-library-192-prompts.md`. Add one section per completed batch before committing
its runtime files.
