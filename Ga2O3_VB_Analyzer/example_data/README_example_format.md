# Example data format

## Experimental VB CSV

```csv
Binding_Energy,Intensity
0.0,123
0.02,125
...
```

## DFT pDOS CSV

```csv
Energy_rel,O_2p,O_2s,Ga_tet,Ga_oct,Ga_3d
0.0,0.5,0.0,0.1,0.1,0.0
0.02,0.6,0.0,0.1,0.1,0.0
...
```

Detailed site/orbital-resolved pDOS is also accepted:

```csv
Energy_rel,O_2p,O_2s,Ga_tet_s,Ga_tet_p,Ga_tet_d,Ga_oct_s,Ga_oct_p,Ga_oct_d
0.0,0.5,0.0,0.0,0.08,0.02,0.0,0.07,0.03
0.02,0.6,0.0,0.0,0.09,0.02,0.0,0.08,0.03
...
```

## Materials Project / pymatgen import

Use the app UI to enter:

```text
Materials Project API key
material_id, for example mp-886 for beta-Ga2O3
```

If site/orbital-projected DOS is available, the app attempts to merge it into:

```text
O_2p, O_2s, Ga_tet_s, Ga_tet_p, Ga_tet_d, Ga_oct_s, Ga_oct_p, Ga_oct_d
```

If site-projected DOS is unavailable, upload a pDOS CSV instead.

## Digitized literature pDOS CSV

Digitized data can use the same columns as the DFT pDOS CSV. Reports will include:

```text
This digitized pDOS is used only as qualitative reference and should not be interpreted quantitatively.
```

## Cross section CSV

```csv
orbital,factor
O_2p,1.0
O_2s,0.5
Ga_4p,0.8
Ga_3d,3.0
Ga_tet,1.0
Ga_oct,1.0
```
