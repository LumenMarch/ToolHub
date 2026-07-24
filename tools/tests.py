import io
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile

from .services import compare_csv_files


class CsvComparisonTests(TestCase):
    def test_detects_added_deleted_and_modified_rows(self):
        source = SimpleUploadedFile("old.csv", b"id,name,team\n1,Alice,Sales\n2,Bob,Ops\n")
        target = SimpleUploadedFile("new.csv", b"id,name,team\n1,Alice,Marketing\n3,Carol,Ops\n")

        result = compare_csv_files(source, target, "id")

        self.assertEqual(len(result["added"]), 1)
        self.assertEqual(len(result["deleted"]), 1)
        self.assertEqual(len(result["modified"]), 1)
        self.assertEqual(result["modified"][0]["changes"][0]["column"], "team")
