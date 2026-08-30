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

## Batch B — Europe

Status: accepted

- Accepted: 36 of 36
- Runtime footprint: 4,208,521 bytes; 116,903 bytes average; 183,206 bytes maximum
- Technical QA: all files are 960×720, three-component, progressive sRGB JPEGs with EXIF, ICC, and
  XMP metadata removed; every file is at most 250 KiB
- Visual QA: all assets were inspected at full runtime resolution in six 3×2 contact sheets, plus
  targeted individual inspection where text or anatomy risk was higher
- Reworked before acceptance: `lisbon-hillside-tram` had three readable house-number plaques;
  the accepted edit removes them while preserving the tram, architecture, light, and crop

| Catalog id | ImageGen output id | Bytes | SHA-256 | Review |
| --- | --- | ---: | --- | --- |
| london-riverside-morning | exec-eb9f20a0-79d6-496e-9b67-3eb09545e069 | 139036 | d89da643995481108794b282253a6001589d08c0f7669c454591826e0c95ad0f | Accepted |
| edinburgh-old-town-mist | exec-7db5ee91-c10a-4836-83b9-325f85ca6251 | 134061 | 6e9de297e35586a8fd953a2977055d2c3432a15f0ba8c8d94bf75b7304d57406 | Accepted |
| lisbon-hillside-tram | exec-7626415a-5c75-4a8d-822a-73a4a8c93929 | 137014 | 91549ad0dfa7b08d67c4a08c01ec7f83084abd215330068a51cb5fb9d0a5cbcf | Accepted after rework |
| porto-riverside-dawn | exec-c6526bc6-9829-4856-bc33-6456c25eef8f | 90688 | 632056e082be3cab30cd85a791e24c9d129610e52d763e8bc43020c5fece425b | Accepted |
| venice-canal-morning | exec-0af8971a-3c02-4cd6-bbaf-9a75f29df6e8 | 158455 | d9284a46057704e967bb2654f54ee18ae72d664b5bc2d8b4382602de6ce53084 | Accepted |
| florence-rooftops-sunset | exec-4afca3c0-bd3f-4454-83ed-6cc622aeffb2 | 110347 | f1e8bbc445b4a3a4f30fb7956907d57d39a1bddbb94a2c9cea2cf4ece00dac79 | Accepted |
| vienna-cafe-street | exec-6dbac014-509b-4909-95d4-801782358f45 | 120853 | afeba24f9ac62b1c29371119ee200607fccea44de31bb33272152d34dfd1ae4d | Accepted |
| prague-rooftops-dawn | exec-e6dfbdf0-188e-46b6-8ca5-9aecc99876e5 | 80861 | b1c88344cfe59d233a13af7cfbe4c6d6efbcf83ac54ac6a781926b092cf21642 | Accepted |
| budapest-danube-evening | exec-55aa893b-026c-4256-9099-4863aa956a3a | 125432 | 13af2f1bea9a2f761e4b04641731505db8e9d5bfbbc305e84401d6b80e41931f | Accepted |
| copenhagen-harbour | exec-43943d49-9b1b-489e-881f-b7bb480cf894 | 164035 | 045de634d834114ef364394a5721e8df19b020b5b13e9150fd3b8235dd22c1b4 | Accepted |
| stockholm-archipelago | exec-413e9399-9d3a-448f-8016-f8411e49c11c | 121373 | 7279ee7f4487b10cd14bbe11716b0b6a675b102d6b0f9442b6d5844a1c19d8f8 | Accepted |
| norwegian-fjord-village | exec-6dfe3b17-fc19-4eb4-965b-7af532dc8719 | 141117 | a232a2dc4412bbb3e9b581cc23a28e862b7c1ecde9974692dc146bf536ae345f | Accepted |
| iceland-black-sand-coast | exec-ded4beb9-04aa-4707-ac9b-4501cf39d535 | 77157 | c31fc8feb7e5ed2f42c6f56a9ffcdcce18e08f776c23205b78eb40aeff8cbdff | Accepted |
| bavarian-alpine-village | exec-c167c769-8403-463a-abfa-645a9e2852f5 | 115459 | 7b671fb38cafb68ec5c55221522c9a850adc9cda2a7d56f2d9ae2a72b7effe58 | Accepted |
| provence-lavender-road | exec-789ece45-3343-4766-8b9e-b0c8d2bcc002 | 151002 | 4769e3f25ae211b451b89222e6c54b7a61fdc60554da72f85daf186a0a54eb01 | Accepted |
| croatian-adriatic-town | exec-f4900c29-b58e-419d-a4e3-75dcd6280c3c | 160548 | 2ca95fd9d657c428d4333dbd99701fe9a0b70aff76059ce913081363d1b8c52f | Accepted |
| slovenia-lake-morning | exec-79d86057-ba7f-40c5-b0d7-2d56b4a0e6f5 | 74496 | 4663e597deb3a6d75ff0bd2a76bf7eb129890ef7a8ea0e79c1f6a1811245d579 | Accepted |
| ireland-atlantic-cliffs | exec-a4f13ae1-d2f5-4061-a7af-dfa859ae1a78 | 161816 | 6c20794988699b9d19d5873bf1e56e1c2a8078f4c6b488c00ec3be19e3a8cbea | Accepted |
| canal-boat-journey | exec-6b0b80fc-33bb-4307-85fe-5ab21a137c80 | 183206 | 75113c27b477acd9b8edcaa3db77b600184b2e2a3d023037752df8f12ae5d140 | Accepted |
| bakery-crawl | exec-7b3ced26-68c8-46ad-8452-7e68fa5db74f | 95750 | 59f891901002fa97c532965161cffa9f8e68daa97bcf96233bc0006862a5b0d5 | Accepted |
| vineyard-lunch | exec-7c565538-864e-4d3b-a2f3-80f2f2513a52 | 134145 | 9c756a466d15049c541e38b42ee559ac09cb0d1510264100bde94b91e09eae7d | Accepted |
| historic-architecture-walk | exec-ac88dce1-0ff9-4a25-8c84-784764de9182 | 153430 | 04697c3d443ed616c052000d2c2b0d6762937a95d167000a75f55ba73f53cf29 | Accepted |
| classical-concert-hall | exec-4ad2a4d3-b73a-483f-a902-3ab8dff271a0 | 155377 | af7306b6b985e584e43e2db9669c24d07d73e15ed8ca9a5c7aa8754626017890 | Accepted |
| alpine-ski-touring | exec-2114ea93-9f10-4c5d-bd4c-03808b6db9b5 | 67299 | 31d8ccc8bbab05d4804519a8a89fa1ccd8286889c6168c185ee25dcd326a299d | Accepted |
| coastal-cliff-hike | exec-8f538073-395a-4038-bb92-3a5392079beb | 136920 | 7ee5bb70f7e1c5354c76ba53be4298725c646906a3510b36c4270d0a36723d2f | Accepted |
| boutique-hotel-breakfast | exec-f33721c0-1641-4dda-827c-91a91335e080 | 85049 | 5c99bc723ae5d69d0147ebaa23ba21a244b379f97bbad661b9dd2852c2fb374e | Accepted |
| anniversary-city-break | exec-46db0bd2-5f80-4edd-9b0e-badc654c6b68 | 105803 | 8646b740c92c975c0252d5ec246c470636d1df2516c71a6397e815553ed734c3 | Accepted |
| spring-meadow-cottage | exec-bb2718b5-d168-4d5c-9f92-732cec21b6f4 | 164526 | c6f3539a9f508cd39543b44286a547921f363d4946c472bb5bf5ab695ad3e8c7 | Accepted |
| summer-mediterranean-evening | exec-be7fa829-053b-4468-b176-db1af243f437 | 100858 | b9261bd515449f98ee58c5dc924bcf95fbb00e4a1cac3d7931f0303e0d4b925c | Accepted |
| autumn-vineyard-mist | exec-190b54f8-17fd-4ec2-86c1-875e65f9fac4 | 102931 | 614b1af45b34ed9b76c11109e59086cc0b21d7d6db3625018b6ca82d36427330 | Accepted |
| winter-european-lake | exec-b3fa420d-1881-42ed-b696-bf34cb024d18 | 91309 | 1653d4eef707b8c98d8a61ae9e8e2d22841dff97ba06b965c1e57b33021bbf4b | Accepted |
| hotel-key-and-luggage | exec-f4d5b7f8-e2e3-4e50-bade-9ffa1ee6017a | 75129 | c2bef37548d22b48f135effc2c5ba213ec5c80c09b86ce26ca88cdaf7ce60d0b | Accepted |
| rainy-window-departure | exec-e0e3da37-f98e-49b5-a6b0-670f47360103 | 82681 | bc72da91ed4e38d9185d0b05158c60b5ef4ef2506187e7f4e4653a2e9aa62e10 | Accepted |
| carry-on-cafe-table | exec-c659157c-57a2-4a7e-8471-2ce40dd83ee2 | 64986 | 5711076b213a765845231440482166224a7573cf2b7f2c637e924a38cdd38292 | Accepted |
| boarding-gate-silhouette | exec-08668bca-a0e9-4417-8443-97ada8288744 | 73459 | da01abf0cba89266c3d72a3b747e8197b5b3015f8565b3b0c9e3f3bfe3c339a6 | Accepted |
| weekend-bag-entryway | exec-7a87387a-5889-4c79-ab7c-22c1002695e4 | 71913 | b5367e8b522379303c16d6211d663e0dbd2c0a106fb8464e1b91ef86c42200b4 | Accepted |

## Batches C–D

Not generated. Their ids and scene specifications are locked in
`tasks/travel-cover-library-192-prompts.md`.
