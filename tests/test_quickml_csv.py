import pandas as pd

from model.data import TARGET, load_train
from model.export_quickml import CSV_PATH, quickml_frame
from model.features import QUICKML_FEATURES


def test_csv_matches_feature_module():
    """The committed CSV must be exactly what build_features() produces today."""
    csv = pd.read_csv(CSV_PATH)
    assert list(csv.columns) == QUICKML_FEATURES + [TARGET]
    assert csv.shape == (4000, len(QUICKML_FEATURES) + 1)
    assert not csv.isna().any().any()
    pd.testing.assert_frame_equal(csv, quickml_frame(load_train()).reset_index(drop=True), check_exact=False, atol=1e-9)


def test_at_most_one_hour_block_per_row():
    blocks = pd.read_csv(CSV_PATH).filter(like="blk_")
    assert blocks.isin([0, 1]).all().all()
    assert (blocks.sum(axis=1) <= 1).all()  # all zeros means the reference block (night)
