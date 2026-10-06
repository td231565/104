import unittest
from pathlib import Path

from extract_job_to_md import extract_job, render_markdown


class ExtractJobTest(unittest.TestCase):
    def test_sample_html(self) -> None:
        record = extract_job(Path(__file__).with_name("jd_sample_1.html"))
        self.assertEqual(record["title"], "RD21113 前端工程師 Frontend Developers (Medical AI)")
        self.assertEqual(record["company"], "華碩電腦股份有限公司")
        self.assertEqual(record["location"], "台北市北投區")
        self.assertIn("4 萬元", record["salary"])
        self.assertIn("可遠端/在家上班", record["benefits"]["其他福利"])
        self.assertEqual(record["benefits"]["應徵網址"], "https://recruit.asus.com/")

        markdown = render_markdown(record)
        self.assertIn("- 公司名稱: 華碩電腦股份有限公司", markdown)
        self.assertNotIn("td231565", markdown)
        self.assertNotIn("@gmail.com", markdown)
        self.assertNotIn("\n|", markdown)


if __name__ == "__main__":
    unittest.main()
