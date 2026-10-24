"""Dev-data adaptations of Interface's ten scenarios; expectations never enter model messages."""

FACTORY = 'proc-factory-dev-003'
CASES = [
    dict(id='printer', building='proc-campus-dev-000', turns=[
        dict(message='Where is the printer?', no_route=True, clarify=True)]),
    dict(id='missing_room', building=FACTORY, turns=[
        dict(message='Take me to room 9.99.', no_route=True, clarify=True)]),
    dict(id='change_destination', building=FACTORY, turns=[
        dict(message='How do I get from Warehouse zone H-C2 to CNC mill H-A1-A?', start='Warehouse zone H-C2', dest='CNC mill H-A1-A'),
        dict(message='Actually, take me to Kitchen 0.28 first instead.', start='Warehouse zone H-C2', dest='Kitchen 0.28')]),
    dict(id='wheelchair', building=FACTORY, turns=[
        dict(message="I'm using a wheelchair today. Take me from Warehouse zone H-C2 to Office 1.20.", start='Warehouse zone H-C2', dest='Office 1.20', step_free=True),
        dict(message='Actually, take me to Toilet 0.22 instead. I have not moved yet.', start='Warehouse zone H-C2', dest='Toilet 0.22', step_free=True),
        dict(message="I've now arrived at Toilet 0.22. Take me to Office 1.20 from here.", start='Toilet 0.22', dest='Office 1.20', step_free=True)]),
    dict(id='lift_closed', building=FACTORY, turns=[
        dict(message="I use a wheelchair. Please route me from Warehouse zone H-C2 to Office 1.20.", start='Warehouse zone H-C2', dest='Office 1.20', step_free=True),
        dict(message='The Office lift is closed for maintenance. Update the map and replan my route.', no_route=True, closed='Office lift'),
        dict(message='The Office lift has reopened. Update the map and show my route again.', start='Warehouse zone H-C2', dest='Office 1.20', step_free=True, reopened=True)]),
    dict(id='coffee', building=FACTORY, turns=[
        dict(message="It's my first day! Where do I get coffee?", no_route=True)]),
    dict(id='toolbox', building=FACTORY, turns=[
        dict(message='My hands are full carrying a toolbox. Give me step-by-step directions from Warehouse zone H-C2 to Server room 1.05.', start='Warehouse zone H-C2', dest='Server room 1.05')]),
    dict(id='door', building='osm-way27917482', turns=[
        dict(message='We punched a new door between Corridor 02.06.001 (Floor 2) and Corridor 2.402 (Floor 2). Add it to the map and tell me how the walk between them changes.', door=True)]),
    dict(id='tour', building=FACTORY, turns=[
        dict(message='From Warehouse zone H-C2, visit Tool cabinet H-A2-A, then CNC mill H-A1-A, then finish at Office 1.20. Give the route in that order with each leg distance and the total.', start='Warehouse zone H-C2', dest='Office 1.20', via=['Tool cabinet H-A2-A','CNC mill H-A1-A'], legs=True)]),
    dict(id='other_floor', building=FACTORY, turns=[
        dict(message='How big is Office 1.20?', area='Office 1.20', clarify=False)]),
    dict(id='nearest_accessible', building=FACTORY, turns=[
        dict(message="I've arrived at Office 1.20 and I use a wheelchair. Remember that."),
        dict(message='Where is the nearest restroom from here? Please give directions.',
             start='Office 1.20', dest='Toilet 1.32', step_free=True)]),
]
