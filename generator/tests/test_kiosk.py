"""キオスクのブラウザを閉じたら、サーバーを止めるテスト(ブラウザは立ち上げない)。"""

from app import kiosk


class FakeProcess:
    """wait() すると、決まった秒数がたってから終わったことにするブラウザ。"""

    def __init__(self, clock, lifetime):
        self.clock, self.lifetime = clock, lifetime

    def wait(self):
        self.clock["now"] += self.lifetime


def watch(monkeypatch, lifetime):
    clock = {"now": 100.0}
    monkeypatch.setattr(kiosk.time, "monotonic", lambda: clock["now"])
    closed = []
    kiosk._watch(FakeProcess(clock, lifetime), clock["now"], lambda: closed.append(True))
    return closed


def test_closing_browser_stops_server(monkeypatch):
    assert watch(monkeypatch, lifetime=600) == [True]


def test_handoff_to_open_kiosk_does_not_stop_server(monkeypatch):
    # 前のキオスクの窓が残っていると、新しいブラウザはすぐに終わる。そのときはサーバーを止めない
    assert watch(monkeypatch, lifetime=1) == []
