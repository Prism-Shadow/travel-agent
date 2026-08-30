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

## Batch C — North and Latin America

Status: accepted

- Accepted: 36 of 36
- Runtime footprint: 4,162,517 bytes; 115,625 bytes average; 182,564 bytes maximum
- Technical QA: all files are 960×720, three-component, progressive sRGB JPEGs with EXIF, ICC, and
  XMP metadata removed; every file is at most 250 KiB
- Visual QA: all assets were inspected at full runtime resolution in six 3×2 contact sheets, plus
  targeted individual inspection where text, anatomy, vehicle, or equipment risk was higher
- Reworked before acceptance: `road-atlas-dashboard` contained dense map labels and pseudo-text;
  the accepted edit replaces them with sparse, unlabeled abstract route lines

| Catalog id | ImageGen output id | Bytes | SHA-256 | Review |
| --- | --- | ---: | --- | --- |
| los-angeles-coast-sunset | exec-01a78da7-fb42-4b2a-a56a-47549e63c7f1 | 85988 | 11d045746b889bb3f699cd49d8887161c7579da22596ad6cfc508a683b646bca | Accepted |
| yosemite-valley-morning | exec-11709971-472d-475d-b80f-9bc791b410f3 | 115543 | 3ad6a6de4399a5128955ea2eb8aabbd5ff5eef326ab0b12d4a383283e699d640 | Accepted |
| utah-canyon-road | exec-6bb4647c-08e3-428f-820e-729c366a3033 | 121854 | ba29512f80919b196c2af62119bd1abd3376f332839c6d1f56e1c60bd855102e | Accepted |
| hawaii-volcanic-coast | exec-29d8d72d-948c-4f18-b116-aa7d6d337207 | 107207 | 5ce2bf2339121f3152a78011dd001de9ae2b4c4614f030f5e1e9397c461c1d25 | Accepted |
| chicago-river-dawn | exec-6cadb77b-9509-4d51-8ca4-cab1aaf6ed9a | 124189 | c8f4aec4f1ad588443920438d7799e22604dcebfc3da9a98348c97687cc216ad | Accepted |
| new-orleans-courtyard | exec-d12b9965-58d1-47d8-8538-58f588c35d66 | 152213 | 3b7b2e080488d896f563d23a5f5a183cb0f712ce574b347fe0132dc29223d99f | Accepted |
| miami-art-deco-morning | exec-31cd1058-b3fb-4043-996d-e4f56d08c34d | 104533 | 46644473188f4ccd40f2278668b21b59f8545610124d7abd261b100e60fa2c87 | Accepted |
| vancouver-harbour-mountains | exec-a8513019-c1ac-4d1e-82f1-6bfdcc3f4f31 | 121794 | a41637174a4e52cd61ad23df2d2bbdc75c4c69c55aff8e427781b18a987b3c0f | Accepted |
| banff-turquoise-lake | exec-786ee8b9-d7b2-4152-bef1-ebf13b67cfea | 171814 | 7ca6c532b2612e016d79feaa17e23c0d2897bdad4e0a0130911cd99bd3abb05e | Accepted |
| toronto-islands-skyline | exec-10a94fce-97cb-4ed3-bc7b-447fd112059a | 91635 | a5ed95003b7529edce419ce128b1733a8f473815a195b59f48ea969edf0140ed | Accepted |
| alaska-glacier-bay | exec-6b93560d-d8d8-4a1c-b6fc-04eeab1f559d | 117653 | bdebcb87f3ec628d0261a391c9f635f6a818070e9501d790e85554c44b8726b2 | Accepted |
| mexico-city-courtyard | exec-f0586ca1-a341-4f06-9ae3-7210df1644fc | 174623 | 440a6ba4de8abac85d333b339140e8b74da845da0813f08ac5d5da3eb0979624 | Accepted |
| costa-rica-cloud-forest | exec-98a3c328-2faf-4e19-8d1c-4c2a523880ec | 177898 | ec69b743242ad320e411e652f2207c91ecc72d6b74e485687960eeeef7087257 | Accepted |
| havana-seafront-dawn | exec-35acac5e-27e6-4658-a5be-ce14ab55027c | 147699 | f88d01d96ce55162a54f4eb224367253aff06ee00394b5bea99dd1cbb8b679b4 | Accepted |
| cartagena-balconies | exec-297bde52-e274-4797-a4c2-b330c62980f4 | 156685 | a7c4fea39703e3b3c0e7781e57079e5b43c3cc48426a7aa8fcb139b26eee081d | Accepted |
| rio-coast-morning | exec-a985c5ba-931a-4932-abb9-caeccf773829 | 114816 | 1d76e1aa26e23fa055cad090ea20256d9f8d03f4764c73664b8b40a442036ff1 | Accepted |
| cusco-andean-rooftops | exec-d85e4957-366a-4d99-a002-9682187e5141 | 125829 | 38392af8404fa8466a04d7f195d47bf39c489424c306a96bf0ad9d527a68f6aa | Accepted |
| buenos-aires-cafe-street | exec-12f9bca4-75b9-45da-af98-1af98e08b304 | 141322 | 6560eeddc549bc0273c7a659c36fdab5244e40a01982b87ccc3b4e5f11f009ec | Accepted |
| campervan-road-trip | exec-ada02ccb-0d91-4f7e-a1a2-962f422971f6 | 101938 | 4fdc12f8bdedec4c4fad07b8ba1f3e579adabde96028753569272b649177dd04 | Accepted |
| taco-cooking-table | exec-c46a51aa-96ae-420b-a234-bc5cc7d89bae | 120799 | 18d621191704ed680d4ff29f74bb6c5beea200ae7189346fd1740aab13dc4e62 | Accepted |
| coffee-farm-tasting | exec-ec2b9882-8929-42d4-b42d-597548a83508 | 97548 | ae3e75fe88f7dc7a26c1aab18b7fd62d321ce09b931594a8649b79a1ee6b014d | Accepted |
| live-music-evening | exec-ed3fdea7-988d-4230-a104-271347f7145b | 78294 | 34d531f9805a13f39fe4cdff64552b6fd21bf0406e77caf8d163a7b6c90d6a4b | Accepted |
| national-park-camping | exec-d0d5f424-20dd-4d6b-9ef6-76b6ddc88417 | 130694 | e431e37b0a344c189af22dfd32eebf79be16daa976bd6f936ec538db8de2365d | Accepted |
| kayaking-mangroves | exec-0d26d4f1-ed45-4c3c-ae79-f61c69b65d5c | 146012 | 194b147d6c8ca8525d92374cbc04c0dd1f407d56685550b5e77cd5a5003126f1 | Accepted |
| beach-resort-hammock | exec-1c5435da-0ed3-4235-a0dd-0810d97efa96 | 137573 | cd7d6f70cc94fe41bda80375fbc299a36332b8c99b00453c1c90473efe43630b | Accepted |
| friends-weekend-trip | exec-c070c62c-53ef-4454-ad43-fdfc60bbef00 | 72493 | e3813d130bad7d5668cbb27bd9c28256f71cbed9de169b665c7213b324f2fd3c | Accepted |
| solo-travel-viewpoint | exec-241052ca-6611-43c3-ab04-5ae75f31bdd4 | 64307 | 589038346fc03af11f7dd2ffa21a3824e5fd6fe0c5768f5ebca82b9120ae9137 | Accepted |
| spring-desert-bloom | exec-261f5816-e5a7-4049-ab07-aed4d7f786e6 | 182564 | d22116ac775562e93024d213bccb095096dac3a00becad5d8d77bb4d054ee275 | Accepted |
| summer-thunderstorm-plains | exec-05173f49-f51c-46cf-9885-c7d3c91fc57c | 81549 | 75f9c1281cdcbf49595a0decc08078a184b76e185217dc7f91efa6cb6dbf222c | Accepted |
| autumn-maple-lake | exec-6828e514-123b-4491-92d4-f00499bd1ddf | 132356 | 1c9d4dca33e7cc8b13bcb9d418a21fea66da2e15ae4da48856f17f111ca5d3e3 | Accepted |
| winter-rockies-sunrise | exec-99bb5036-7ba5-449a-a1fa-90f25068cb94 | 100575 | f173018aad196f4e336cf7792f5c3a6bef0b1108b8dc8a2b78ae9a078fa2f52f | Accepted |
| road-atlas-dashboard | exec-a173e28a-9caf-402e-af27-89a0c6683e82 | 53229 | b354425097f416cc9a11de6205c4808ecd72377827e29ef5ca037c44ebc7e405 | Accepted after rework |
| airport-walkway-light | exec-92df5c10-8502-4178-922a-4e79a5fcf983 | 80675 | b74061ecb8f57d3c0f6c4fde7bbf73305d7000e18f5b4ed24fd4518806be36c1 | Accepted |
| camera-and-sunglasses | exec-9da5f907-1798-4cc9-a244-425673ccd209 | 72078 | 8623a6226dbee65c54d2c8518a8f3b87103dc2817d3b0d08a101c359122d9d58 | Accepted |
| reusable-bottle-backpack | exec-269860d2-4bd9-4c61-8598-404e49dd35f6 | 71921 | 5bf4f5673f161919f865346e2e033533968f5876a4682fe9a14fd9eebf478fd7 | Accepted |
| motel-arrival-twilight | exec-ed389d92-7994-4643-99ca-29ecfb333212 | 84617 | f1c1781e088b26e6467a18d47f69b2ff9b0f920c202f5bd6d2960fbaee04ba3e | Accepted |

## Batch D — Asia, Africa, Middle East, and remaining intent gaps

Status: accepted

- Accepted: 36 of 36
- Runtime footprint: 3,975,808 bytes; 110,439 bytes average; 186,012 bytes maximum
- Technical QA: all files are 960×720, three-component, progressive sRGB JPEGs with EXIF, ICC, and
  XMP metadata removed; every file is at most 250 KiB
- Visual QA: all assets were inspected at full runtime resolution in six 3×2 contact sheets, plus
  targeted individual inspection where anatomy, equipment, or text risk was higher
- Reworked before acceptance: `autumn-savanna-gold` repeated the acacia-silhouette composition and
  palette of `serengeti-dawn`; the accepted edit uses a low grass-focused composition with no trees
  or wildlife

| Catalog id | ImageGen output id | Bytes | SHA-256 | Review |
| --- | --- | ---: | --- | --- |
| kanazawa-garden-winter | exec-f8a7316c-cabf-4fec-9c55-94b02e979279 | 186012 | c4edde1846da8e056731eed8ca9c41fc570e704c5a31c1ff8b69022cf1f519db | Accepted |
| busan-coast-morning | exec-c8c7b043-3b7e-4a07-9c3f-50880e4bcad0 | 105448 | a5ae80d74f6c09185b474b54f69e4d61081979189e46899349a5788517e3669a | Accepted |
| zhangjiajie-mist-mountains | exec-a116a9b7-fd36-45d8-b61d-5b27c3b01709 | 79951 | 580d38267f392dcc0d18fb0495ea8ac0e0a0e6c2f13dcea97bf6c06733f455ea | Accepted |
| mongolia-steppe-camp | exec-ac406590-dfea-4cac-9f38-9828fc226f97 | 111753 | 029caecc3663574fa87245c40e7d50a53f1a227225fa93c2016809186b4820a9 | Accepted |
| kuala-lumpur-tropical-rooftops | exec-922190de-edb5-46ce-9bf4-8400e2a1217c | 105642 | 4e2d6f9c19732a989f454d61802e6292686211d4cb7fcd36644c16db3320ecd0 | Accepted |
| siem-reap-forest-temples | exec-8a67a5af-38d4-4590-be80-091fb7ee593f | 138502 | 69af2b36682e2839da44f7e447a68af2e9fe5502f577f3a20dc23a1c90517a34 | Accepted |
| komodo-island-coast | exec-956a99c7-e2ac-4601-8340-931b6ae96a81 | 153124 | 5d2927426401ed414c46d0dc5be703456da3eedb22d90adcfbc2cbb4d117a17a | Accepted |
| jaipur-courtyard-morning | exec-c9a8987d-6e68-4c54-ba24-69df150712c7 | 147937 | 15a8e01675a908e260421b7c094494ed06130c8a9cea821e8ddbaf80109f63ed | Accepted |
| nepal-himalayan-village | exec-4750d62f-a401-42d1-8e0b-556a3d330344 | 178530 | bcf709dd7ecb2b5002ee434f3446b5d914c400a126aa871c43d957619320381f | Accepted |
| sri-lanka-tea-hills | exec-ad069182-f563-49f3-a9ae-4b20251f0d7c | 139430 | 6bd0375633eb628806745b72ac80ae6275516a07d8ea5d3c3779fe4d1e415b3b | Accepted |
| istanbul-bosphorus-dawn | exec-dac69761-a1ad-42f8-bb54-f0e53f1b1f0f | 95764 | 2c7a53653b5cbbc43ad9f197d1e433bff63d5b4cc9226f69209477638192df7e | Accepted |
| jordan-wadi-desert | exec-4e4ce202-bd6d-4189-a7f9-6d64ff7ae256 | 96660 | f67e312ca706ff6a7b298342598e08ee962d78f910340abae881d7fece275c07 | Accepted |
| oman-mountain-wadi | exec-e4b4d277-0923-4943-8e5f-8db2d5adab1c | 143146 | bdac7998a7fecab3f0c53602828e3fc12ccb3d72cc97978ae6bb3a7ef055cfc9 | Accepted |
| serengeti-dawn | exec-8710fbc3-7ac1-4983-8aa0-bcd765f458c6 | 79002 | 465d8522b5242bd5e273181cdb86458ea128c6a703f7b8f9b1c9dc0c2cf16da5 | Accepted |
| zanzibar-stone-town | exec-0e24c603-9b30-4c69-9dd6-ae9ecf448e4b | 175391 | 1dee092d17eb562602dae61077607aaf4c358c3c9440b06390c2373283347643 | Accepted |
| namibia-dunes | exec-6913a7ed-ce9a-4918-b538-23b5a670a6c3 | 65115 | e7cef0e144f39caeb18f32e2456182646f779d7f4a838b292f800b9c9b69ac5a | Accepted |
| cairo-nile-evening | exec-2480104a-a98f-4d8e-b1c7-d73d531f9614 | 106551 | 4e3496cd07144d6bdc37533a356ed8a2d9b132e491747ca37b0b4073ce5db8e4 | Accepted |
| queensland-reef-islands | exec-e0c0b3fd-977a-4bac-97f5-da948f7e2622 | 107424 | 4e63ca203defb6a0508b6559d75fd463e78eac6a2673dd31c4c306e21253c8f8 | Accepted |
| desert-road-journey | exec-0bb726aa-5d23-42ed-84ce-4c1b63b6957b | 59881 | 78801f82b7a8cf4b7fcab4c7b818282a145c506d6d5d7da9d294f34c6cf66f8a | Accepted |
| spice-market-cooking | exec-25ca4542-b2c1-47d7-a21e-cc93624a00e2 | 72369 | d4ce6f3cd5f0960ed5cb96d3ddff99a3f8e437a1ac55ba2f8100f8f9c768f3fe | Accepted |
| artisan-workshop-visit | exec-9a50d20d-7ea6-4fc8-a6e7-f278ed86ff85 | 91191 | 7d63019320cc9960606bf0ed39decc79bd98661ec72913ad20c2fffcdeb4ef6f | Accepted |
| archaeological-site-walk | exec-131ce592-f11f-47c9-968b-7e55bdf2b773 | 139597 | 06366a8e1af9eea37918b869155cdb106b6d1d95211fd07319873f4c12e0d6c6 | Accepted |
| safari-game-drive | exec-c9208b56-be6b-4789-8b20-5b430c211a04 | 65551 | a34f62e11a3b0c1f32c68c1ac7b3e8e0815d2fef4fa2c3bd6b861a352713b006 | Accepted |
| desert-camp-evening | exec-925690a6-e94e-44b1-9fb7-b3c206212493 | 52863 | ad300291151f6ac59c2fc9c04e313b8e4cb4b187a17db08e6e723ee8d236b43c | Accepted |
| eco-lodge-rainforest | exec-bc199035-5e7a-4181-9e0f-5eb3dea52807 | 155658 | 10a328c56337ad5fe25549fc18e568abd2c32cb07831ad1702c63733dfd33335 | Accepted |
| honeymoon-island-escape | exec-3482d3d7-83e5-45eb-ab55-e42fc80280fc | 96989 | 13f12ed6686479bb14c5333a097e3943a729cae784506246e24aba23250802ac | Accepted |
| accessible-travel-city-break | exec-0404c659-00dc-414b-8ea4-c1a8ca8140e4 | 127394 | cb80871a1283effa540b904539157ca0e73e9bd95794060eeec5f05ab54a5dd1 | Accepted |
| spring-wildflower-valley | exec-9c784430-9676-4a0e-923f-a6e9e2d1637a | 135647 | 86bbd7c54c2adb9f8bb4d5d3b3d62727f17233a64c5778c66e5d75756d63acad | Accepted |
| summer-tropical-rain | exec-a9fd77ea-1150-445e-8c89-8f50b30d19e3 | 174769 | 0099ad3facf9edb29fde6ba9b348c04cf7f10c5fb37d1e7a1b195fdfecc079f7 | Accepted |
| autumn-savanna-gold | exec-a1f532a5-8fb3-4018-bcb2-0f3b4c123ae8 | 110902 | 1c982425fe0606d04f0a0e318d440a5339fc27b584d914be9a747cdc97c8f21b | Accepted after rework |
| winter-desert-night | exec-47091559-edda-479d-98a5-0aa1ff3bdab6 | 86081 | 22743ce9eb5ee17543cbc83bb3ce67accd2fd5438f19c9432aaac1dab8f57a79 | Accepted |
| itinerary-cards-flatlay | exec-4eaba83c-a2f1-4bd1-9ddc-85f7bf3c619d | 67635 | 86c5998ff940437bba25efec43448d8534a47a1eb6125e772e93993dbc2fd385 | Accepted |
| charging-kit-travel | exec-f5fcb600-1660-4c2b-b459-fa7bc112e645 | 104770 | 4abdf7ee25eef5f3210e04dc77a48bdaf047697c8d00906d1590a60cbbfcc7eb | Accepted |
| luggage-rack-room | exec-35f1517e-41c5-4345-bf70-9386d49c20bc | 75974 | e2ee47ac2ad9efe19dda7175074a52c0cde6d5a4bc13606f3f687a556835687e | Accepted |
| sunrise-through-window | exec-81041f6e-2faf-405e-99f9-f5250090ac90 | 41382 | 8b6cebb05753b4bb332731eefaca3d67c9061202f572e51e2fb32640bcfa3981 | Accepted |
| compass-and-boots | exec-c34feddc-d1e9-4594-999f-96cbee6a4834 | 101773 | 22732a972f230b3f4d03512aae30e730e6d7bec1594f4bf0b264b359a9f9ad68 | Accepted |
