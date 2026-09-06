from madewith_github.classifier import classify

def test_classifies_cms_application():
    c=classify({"name":"AcmeCMS","description":"Self-hosted headless CMS content management platform","is_template":False},["cms","headless-cms"],"",["application","library"])
    assert c.project_type=="application"
    assert "cms" in c.categories
