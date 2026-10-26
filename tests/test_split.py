from model.data import load_train
from model.split import time_split


def test_split_is_80_20_by_time():
    fit, val = time_split(load_train())
    assert (len(fit), len(val)) == (3200, 800)
    assert fit["timestamp"].max() < val["timestamp"].min()
    assert str(val["timestamp"].min()) == "2015-05-14 07:00:00"


def test_split_ignores_row_order():
    df = load_train()
    fit, val = time_split(df.sample(frac=1, random_state=0))
    ref_fit, ref_val = time_split(df)
    assert fit.index.equals(ref_fit.index)
    assert val.index.equals(ref_val.index)


def test_split_covers_every_row_once():
    df = load_train()
    fit, val = time_split(df)
    assert fit.index.intersection(val.index).empty
    assert len(fit.index.union(val.index)) == len(df)
